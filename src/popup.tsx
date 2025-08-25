import React, { useState, useEffect, FormEvent, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import browser from 'webextension-polyfill';

type Model = { name: string };
type QueueStatus = { heavy: number; light: number };
type P2PState = { mode: 'NONE' | 'HOST' | 'CLIENT'; status: string; hostId: string | null; peerId: string | null; };

const Popup = () => {
  const [endpoint, setEndpoint] = useState('');
  const [currentEndpoint, setCurrentEndpoint] = useState('');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('');
  const [models, setModels] = useState<Model[]>([]);
  const [response, setResponse] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [domains, setDomains] = useState<string[]>([]);
  const [newDomain, setNewDomain] = useState('');
  const [isHelpVisible, setIsHelpVisible] = useState(false);
  
  const [isAdvancedVisible, setIsAdvancedVisible] = useState(false);
  const [modelToPull, setModelToPull] = useState('');
  const [pullStatus, setPullStatus] = useState('Idle');
  const [isPulling, setIsPulling] = useState(false);
  
  const [modelToConfirmDelete, setModelToConfirmDelete] = useState<string | null>(null);

  const [concurrencyLimits, setConcurrencyLimits] = useState({ heavy: 1, light: 2 });
  const debounceTimer = useRef<number | null>(null);

  const [queueStatus, setQueueStatus] = useState<QueueStatus>({ heavy: 0, light: 0 });

  const [p2pState, setP2PState] = useState<P2PState>({ mode: 'NONE', status: 'Disconnected', hostId: null, peerId: null });
  const [p2pModeSelection, setP2PModeSelection] = useState<'host' | 'client'>('client');
  const [peerIdInput, setPeerIdInput] = useState('');

  const _sendMessage = (message: object): Promise<any> => browser.runtime.sendMessage(message);

  const loadEndpoint = () => {
    _sendMessage({ type: "getEndpoint" }).then(res => {
      if (res?.endpoint) setCurrentEndpoint(res.endpoint);
    });
  };

  const fetchModels = () => {
    _sendMessage({ type: "fetchModels" }).then((res: any) => {
      if (res?.success && res.data?.models) {
        setModels(res.data.models);
      } else {
        setModels([]);
        setError(res?.error || "Could not fetch models.");
      }
    });
  };

  const loadDomains = () => {
    _sendMessage({ type: "getDomains" }).then(res => {
      if (res?.domains) setDomains(res.domains);
    });
  };

  useEffect(() => {
    loadEndpoint();
    fetchModels();
    loadDomains();
    _sendMessage({ type: "getLimits" }).then(limits => {
        if (limits) setConcurrencyLimits(limits);
    });
    _sendMessage({ type: "p2p_get_status" }).then(state => {
        if (state) setP2PState(state);
    });

    const port = browser.runtime.connect({ name: "popup-status-port" });
    port.onMessage.addListener((msg) => {
        if (msg.type === 'queueStatusUpdate') {
            setQueueStatus(msg.status);
        } else if (msg.type === 'p2pStatusUpdate') {
            setP2PState(msg.state);
        }
    });

    return () => port.disconnect();
  }, []);
  
  useEffect(() => {
    // If we connect or disconnect, refresh models
    if (p2pState.status.includes('Connected') || p2pState.status.includes('Disconnected')) {
      fetchModels();
    }
  }, [p2pState.status]);

  const handleSetEndpoint = () => {
    if (!endpoint) return;
    _sendMessage({ type: "setEndpoint", endpoint }).then(() => {
      setEndpoint('');
      loadEndpoint();
      fetchModels();
    });
  };

  const handleSendPrompt = (e: FormEvent) => {
    e.preventDefault();
    if (!prompt || !model) {
      setError("Please enter a prompt and select a model.");
      return;
    }
    setError('');
    setResponse('');
    setIsLoading(true);

    const port = browser.runtime.connect({ name: "ollama-stream" });
    
    port.onMessage.addListener((msg) => {
      if (msg.type === 'CHUNK') { setResponse(prev => prev + (msg.data.response || '')); }
      else if (msg.type === 'DONE') { setIsLoading(false); port.disconnect(); }
      else if (msg.type === 'ERROR') { setError(msg.error || "An unknown error occurred."); setIsLoading(false); port.disconnect(); }
    });
    port.onDisconnect.addListener(() => setIsLoading(false));
    port.postMessage({
      type: "streamRequest", endpoint: "/api/generate",
      params: { model, prompt, stream: true }
    });
  };

  const handlePullModel = () => {
    if (!modelToPull || isPulling) return;
    if (models.some(m => m.name.split(':')[0] === modelToPull.split(':')[0])) {
        setPullStatus(`Error: A version of '${modelToPull}' may already be downloaded.`);
        return;
    }
    setIsPulling(true);
    setPullStatus(`Preparing to pull '${modelToPull}'...`);
    const port = browser.runtime.connect({ name: "ollama-stream" });

    port.onMessage.addListener((msg) => {
        if (msg.type === 'CHUNK') {
            const status = msg.data.status;
            if (msg.data.total && msg.data.completed) {
                const percentage = Math.round((msg.data.completed / msg.data.total) * 100);
                setPullStatus(`${status} (${percentage}%)`);
            } else { setPullStatus(status); }
        } else if (msg.type === 'DONE') {
            setPullStatus(`Successfully pulled '${modelToPull}'!`);
            setModelToPull(''); fetchModels(); setIsPulling(false); port.disconnect();
        } else if (msg.type === 'ERROR') {
            setPullStatus(`Error: ${msg.error}`); setIsPulling(false); port.disconnect();
        }
    });
    port.onDisconnect.addListener(() => setIsPulling(false));
    port.postMessage({
        type: "streamRequest", endpoint: "/api/pull",
        params: { name: modelToPull, stream: true }
    });
  };

  const confirmDeleteModel = () => {
    if (!modelToConfirmDelete) return;
    _sendMessage({ type: "deleteModel", model: modelToConfirmDelete }).then(res => {
        if (res.success) {
            fetchModels();
        } else {
            setError(res.error || `Failed to delete ${modelToConfirmDelete}`);
        }
        setModelToConfirmDelete(null);
    });
  };
  
  const cancelDeleteModel = () => {
    setModelToConfirmDelete(null);
  };
  
  const handleLimitsChange = (type: 'heavy' | 'light', value: string) => {
    const numValue = parseInt(value, 10);
    if (isNaN(numValue) || numValue < 1) return;

    const newLimits = { ...concurrencyLimits, [type]: numValue };
    setConcurrencyLimits(newLimits);

    if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
    }

    debounceTimer.current = window.setTimeout(() => {
        _sendMessage({ type: "setLimits", limits: newLimits });
    }, 500);
  };

  const handleClearQueues = () => _sendMessage({ type: 'clearQueues' });
  
  const handleAddDomain = () => { if (!newDomain) return; _sendMessage({ type: "addDomain", domain: newDomain }).then(() => { setNewDomain(''); loadDomains(); }); };
  const handleAddCurrentDomain = () => _sendMessage({ type: "addCurrentDomain" }).then(loadDomains);
  const handleAllowAllDomains = () => _sendMessage({ type: "allowAllDomains" }).then(loadDomains);
  const handleRemoveDomain = (domain: string) => _sendMessage({ type: "removeDomain", domain }).then(loadDomains);
  const toggleHelp = () => setIsHelpVisible(!isHelpVisible);
  const toggleAdvanced = () => setIsAdvancedVisible(!isAdvancedVisible);

  const areQueuesEmpty = queueStatus.heavy === 0 && queueStatus.light === 0;

  const handleStartHosting = () => _sendMessage({ type: 'p2p_start_hosting' });
  const handleConnectToPeer = () => { if (peerIdInput) _sendMessage({ type: 'p2p_connect', peerId: peerIdInput }); };
  const handleP2PDisconnect = () => _sendMessage({ type: 'p2p_disconnect' });

  const isP2PConnected = p2pState.mode !== 'NONE';

  return (
    <div className="container">
      <div className="title-bar">
        <h2>Ollama LLM Chat</h2>
        <a href="#" className="help-toggle" onClick={toggleHelp}>{isHelpVisible ? 'Close' : 'Help'}</a>
      </div>

      {isHelpVisible && (
        <div className="help-section">
          <p>
            This extension acts as a proxy to your Ollama instance at <strong>{currentEndpoint}</strong> (can be modified in extension). It can forward requests to any valid Ollama API endpoint.
          </p>
          
          <p>
             <strong>Prerequisites:</strong>
            <ul>
            <li>Ollama must be installed and running on your local machine.</li>
            <li>CORS settings must be configured for your browser extension. See the project's <a href="https://github.com/ashu01304/Ollama_Web" target="_blank" rel="noopener noreferrer">README</a> for instructions.</li>
          </ul>
          </p>

          <strong>Example Endpoints:</strong>
          <p>
          <ul>
            <li><code>/api/generate</code> (generate response)</li>
            <li><code>/api/chat</code> (chat with a model)</li>
            <li><code>/api/tags</code> (list local models)</li>
            <li><code>/api/pull</code> (download a model)</li>
          </ul>
          </p>
          <p>
            <strong>For Developers:</strong> Add your app's origin (e.g., <code>http://localhost:3000/*</code>) to the "Allowed Domains" list. For more info, see the <a href="https://github.com/ashu01304/Ollama_Web" target="_blank" rel="noopener noreferrer">GitHub repository</a>.
          </p>
        </div>
      )}
      
      <h3>Ollama Endpoint</h3>
      <p className="setting-description" style={{color: isP2PConnected ? 'var(--color-accent)' : 'inherit'}}>
        {isP2PConnected ? `Using peer connection. Local endpoint is disabled.` : `Using local endpoint.`}
      </p>
      <input
          type="text"
          placeholder={`Current: ${currentEndpoint}`}
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          disabled={isP2PConnected}
          />
      <div className="button-row">
        <button onClick={handleSetEndpoint} disabled={isP2PConnected}>Set Endpoint</button>
        <button onClick={toggleAdvanced}>Advanced {isAdvancedVisible ? '▲' : '▼'}</button>
      </div>
      
      {isAdvancedVisible && (
        <div className="advanced-section">
            <h4>Peer-to-Peer Sharing</h4>
            <div className="p2p-container">
              <div className="p2p-status">
                  <span className={`p2p-status-dot ${p2pState.mode !== 'NONE' ? 'connected' : ''}`}></span>
                  <span>{p2pState.status}</span>
              </div>

              {p2pState.mode === 'NONE' ? (
                  <>
                      <div className="p2p-mode-selector">
                          <label><input type="radio" value="client" checked={p2pModeSelection === 'client'} onChange={() => setP2PModeSelection('client')} /> Use a Friend's Ollama</label>
                          <label><input type="radio" value="host" checked={p2pModeSelection === 'host'} onChange={() => setP2PModeSelection('host')} /> Share My Ollama</label>
                      </div>

                      {p2pModeSelection === 'client' && (
                          <div className="p2p-action-area">
                              <input type="text" placeholder="Enter Friend's Connection ID" value={peerIdInput} onChange={(e) => setPeerIdInput(e.target.value)} />
                              <button onClick={handleConnectToPeer} disabled={!peerIdInput}>Connect</button>
                          </div>
                      )}
                      {p2pModeSelection === 'host' && (
                          <div className="p2p-action-area">
                              <button onClick={handleStartHosting}>Start Sharing</button>
                          </div>
                      )}
                  </>
              ) : (
                  <div className="p2p-action-area">
                      {p2pState.mode === 'HOST' && p2pState.hostId && (
                          <div className="p2p-host-id">
                              <span>Your ID: <strong>{p2pState.hostId}</strong></span>
                              <button onClick={() => navigator.clipboard.writeText(p2pState.hostId || '')}>Copy</button>
                          </div>
                      )}
                      <button className="disconnect-btn" onClick={handleP2PDisconnect}>Disconnect</button>
                  </div>
              )}
            </div>

            <h4>Queue Status</h4>
            <div className="queue-status-container">
                <div className="queue-status-item"><span>Heavy Tasks Pending:</span> <strong>{queueStatus.heavy}</strong></div>
                <div className="queue-status-item"><span>Light Tasks Pending:</span> <strong>{queueStatus.light}</strong></div>
                <button className="clear-queue-btn" onClick={handleClearQueues} disabled={areQueuesEmpty}>Clear Queues</button>
            </div>

            <h4>Model Management</h4>
            <div className="model-management-container">
                <input type="text" placeholder="Enter model name (e.g., gemma:2b)" value={modelToPull} onChange={(e) => setModelToPull(e.target.value)} disabled={isPulling} />
                <button onClick={handlePullModel} disabled={isPulling || !modelToPull}>
                    {isPulling ? '...' : 'Pull'}
                </button>
            </div>
            <div className="pull-status">{pullStatus}</div>
            
            <h4>Local Models</h4>
            {modelToConfirmDelete ? (
                <div className="confirmation-dialog">
                    <p>Are you sure you want to delete <strong>{modelToConfirmDelete}</strong>?</p>
                    <div className="confirmation-buttons">
                        <button className="confirm-btn" onClick={confirmDeleteModel}>Confirm Delete</button>
                        <button className="cancel-btn" onClick={cancelDeleteModel}>Cancel</button>
                    </div>
                </div>
            ) : (
                <ul className="local-models-list">
                    {models.length > 0 ? models.map(m => (
                        <li key={m.name}>
                            <span>{m.name}</span>
                            <button onClick={() => setModelToConfirmDelete(m.name)}>Delete</button>
                        </li>
                    )) : <li className="empty-list-item">No models found.</li>}
                </ul>
            )}

            <h4>Concurrency Limits</h4>
            <p className="setting-description">Control how many parallel requests are sent to Ollama.</p>
            <div className="concurrency-settings">
                <div className="setting-item">
                    <label htmlFor="heavy-limit">Heavy Tasks Limit</label>
                    <input
                        type="number" id="heavy-limit" min="1"
                        value={concurrencyLimits.heavy}
                        onChange={(e) => handleLimitsChange('heavy', e.target.value)}
                    />
                </div>
                <div className="setting-item">
                    <label htmlFor="light-limit">Light Tasks Limit</label>
                    <input
                        type="number" id="light-limit" min="1"
                        value={concurrencyLimits.light}
                        onChange={(e) => handleLimitsChange('light', e.target.value)}
                    />
                </div>
            </div>
        </div>
      )}

      <h3>Chat</h3>
      <form onSubmit={handleSendPrompt} style={{display: 'contents'}}>
        <input type="text" id="prompt" autoComplete="off" placeholder="Enter your prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        <div className="button-container">
          <select id="modelSelect" value={model} onChange={(e) => setModel(e.target.value)} disabled={models.length === 0}>
            <option value="">{models.length === 0 ? "No models found" : "Select a model"}</option>
            {models.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
          </select>
          <button type="submit" id="sendButton" disabled={isLoading}>{isLoading ? '...' : 'Send'}</button>
        </div>
      </form>
      
      <div id="response" style={{ color: error ? 'var(--color-danger)' : 'inherit' }}>
        {isLoading && !response && 'Loading...'}
        {response || (!isLoading ? error || 'Response will appear here' : '')}
      </div>
      
      <h3>Allowed Domains</h3>
      <div className="domain-container">
        <input type="text" id="domainInput" placeholder="Enter domain (e.g., *.example.com/*)" value={newDomain} onChange={(e) => setNewDomain(e.target.value)}/>
        <div className="button-row">
          <button onClick={handleAddDomain}>Add</button>
          <button onClick={handleAddCurrentDomain}>Add Current</button>
          <button onClick={handleAllowAllDomains}>Allow All</button>
        </div>
      </div>
      
      <ul id="domainList">
        {domains.length > 0 ? domains.map(d => (
          <li key={d}><span>{d}</span><button onClick={() => handleRemoveDomain(d)}>Remove</button></li>
        )) : <li className="empty-list-item">No domains added.</li>}
      </ul>
    </div>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<Popup />);