import React, { useState, useEffect, FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import browser from 'webextension-polyfill';

type Model = { name: string };

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
  }, []);

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
      if (msg.type === 'CHUNK') {
        setResponse(prev => prev + (msg.data.response || ''));
      } else if (msg.type === 'DONE') {
        setIsLoading(false);
        port.disconnect();
      } else if (msg.type === 'ERROR') {
        setError(msg.error || "An unknown streaming error occurred.");
        setIsLoading(false);
        port.disconnect();
      }
    });

    port.onDisconnect.addListener(() => {
      setIsLoading(false);
      if (port.error) {
        setError(`Disconnected: ${port.error.message}`);
      }
    });
    
    port.postMessage({
      type: "streamOllama",
      params: {
        model: model,
        prompt: prompt,
        stream: true
      }
    });
  };

  const handleAddDomain = () => {
    if (!newDomain) return;
    _sendMessage({ type: "addDomain", domain: newDomain }).then(() => {
      setNewDomain('');
      loadDomains();
    });
  };

  const handleAddCurrentDomain = () => {
    _sendMessage({ type: "addCurrentDomain" }).then(loadDomains);
  };
  
  const handleAllowAllDomains = () => {
    _sendMessage({ type: "allowAllDomains" }).then(loadDomains);
  };

  const handleRemoveDomain = (domain: string) => {
    _sendMessage({ type: "removeDomain", domain }).then(loadDomains);
  };
  
  const toggleHelp = () => {
    setIsHelpVisible(!isHelpVisible);
  };

  return (
    <div className="container">
      <div className="title-bar">
        <h2>Ollama LLM Chat</h2>
        <a href="#" className="help-toggle" onClick={toggleHelp}>
          {isHelpVisible ? 'Close' : 'Help'}
        </a>
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
      <input
        type="text"
        id="endpointInput"
        placeholder={`Current: ${currentEndpoint}`}
        value={endpoint}
        onChange={(e) => setEndpoint(e.target.value)}
      />
      <button id="setEndpointButton" onClick={handleSetEndpoint}>Set Endpoint</button>

<form onSubmit={handleSendPrompt} style={{display: 'contents'}}>
        <input
          type="text"
          id="prompt"
          autoComplete="off"
          placeholder="Enter your prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />

        <div className="button-container">
          <select id="modelSelect" value={model} onChange={(e) => setModel(e.target.value)} disabled={models.length === 0}>
            <option value="">{models.length === 0 ? "No models found" : "Select a model"}</option>
            {models.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
          </select>
          <button type="submit" id="sendButton" disabled={isLoading}>
            {isLoading ? '...' : 'Send'}
          </button>
        </div>
      </form>
      
      <div id="response" style={{ color: error ? 'var(--color-danger)' : 'inherit' }}>
        {isLoading && !response && 'Loading...'}
        {response || (!isLoading ? error || 'Response will appear here' : '')}
      </div>
      
      <h3>Allowed Domains</h3>
      <div className="domain-container">
        <input
          type="text"
          id="domainInput"
          placeholder="Enter domain (e.g., *.example.com/*)"
          value={newDomain}
          onChange={(e) => setNewDomain(e.target.value)}
        />
        <div className="button-row">
          <button id="addDomainButton" onClick={handleAddDomain}>Add</button>
          <button id="addCurrentDomainButton" onClick={handleAddCurrentDomain}>Add Current</button>
          <button id="allowAllButton" onClick={handleAllowAllDomains}>Allow All</button>
        </div>
      </div>
      
      <ul id="domainList">
        {domains.length > 0 ? domains.map(d => (
          <li key={d}>
            <span>{d}</span>
            <button onClick={() => handleRemoveDomain(d)}>Remove</button>
          </li>
        )) : <li className="empty-list-item">No domains added.</li>}
      </ul>
    </div>
  );
};

const container = document.getElementById('root');
const root = createRoot(container!);
root.render(<Popup />);