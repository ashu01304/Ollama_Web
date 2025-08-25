import browser from "webextension-polyfill";

const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_HEAVY_CONCURRENCY = 1;
const DEFAULT_LIGHT_CONCURRENCY = 2;

const HEAVY_ENDPOINTS = ['/api/generate', '/api/chat', '/api/pull'];
const HEAVY_TYPES = ['generate', 'chat', 'pull', 'streamRequest'];

const SIGNALING_SERVER_URL = 'wss://ollama-signaler.onrender.com';
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }]; // Using Google's public STUN server

let popupPorts = new Set<browser.Runtime.Port>();

// --- P2PManager ---
class P2PManager {
    private state: { mode: 'NONE' | 'HOST' | 'CLIENT'; status: string; hostId: string | null; peerId: string | null; } = { mode: 'NONE', status: 'Disconnected', hostId: null, peerId: null };
    private ws: WebSocket | null = null;
    private pc: RTCPeerConnection | null = null;
    private dc: RTCDataChannel | null = null;
    private pendingRequests = new Map<string, { resolve: (value: any) => void; reject: (reason?: any) => void }>();
    private streamPorts = new Map<string, browser.Runtime.Port>();

    constructor() { this.broadcastState(); }
    
    getState() { return this.state; }

    private setState(updates: Partial<typeof this.state>) {
        this.state = { ...this.state, ...updates };
        this.broadcastState();
    }

    private broadcastState() {
        for (const port of popupPorts) {
            port.postMessage({ type: 'p2pStatusUpdate', state: this.state });
        }
    }

    private connectSignaling() {
        return new Promise<void>((resolve, reject) => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) return resolve();
            if (this.ws) this.ws.close();

            this.ws = new WebSocket(SIGNALING_SERVER_URL);
            this.ws.onopen = () => resolve();
            this.ws.onerror = (err) => { this.setState({ status: 'Signaling Error' }); reject(err); };
            this.ws.onmessage = (event) => this.handleSignalingMessage(JSON.parse(event.data));
            this.ws.onclose = () => { if (this.state.mode !== 'NONE') this.disconnect('Signaling server disconnected.'); };
        });
    }

    async startHosting() {
        if (this.state.mode !== 'NONE') await this.disconnect();
        this.setState({ mode: 'HOST', status: 'Connecting...' });
        try {
            await this.connectSignaling();
            this.ws?.send(JSON.stringify({ type: 'register-host' }));
        } catch (e) { this.disconnect('Failed to connect to signaling server.'); }
    }

    async connectToPeer(peerId: string) {
        if (this.state.mode !== 'NONE') await this.disconnect();
        this.setState({ mode: 'CLIENT', status: 'Connecting...', peerId });
        try {
            await this.connectSignaling();
            this.setupPeerConnection();
            const offer = await this.pc!.createOffer();
            await this.pc!.setLocalDescription(offer);
            this.ws?.send(JSON.stringify({ type: 'offer', targetId: peerId, sdp: offer }));
        } catch (e) { this.disconnect('Failed to connect to peer.'); }
    }

    private setupPeerConnection(isHost = false) {
        this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
        this.pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.ws?.send(JSON.stringify({ type: 'ice-candidate', targetId: this.state.peerId || this.state.hostId, candidate: event.candidate }));
            }
        };
        this.pc.onconnectionstatechange = () => {
            if (this.pc?.connectionState === 'connected') this.setState({ status: this.state.mode === 'HOST' ? `Connected to Peer` : `Connected to Host: ${this.state.peerId}` });
            if (['disconnected', 'failed', 'closed'].includes(this.pc?.connectionState || '')) this.disconnect('Peer disconnected.');
        };
        if (isHost) {
            this.pc.ondatachannel = (event) => this.setupDataChannel(event.channel);
        } else {
            const channel = this.pc.createDataChannel('ollama-proxy');
            this.setupDataChannel(channel);
        }
    }

    private setupDataChannel(channel: RTCDataChannel) {
        this.dc = channel;
        this.dc.onopen = () => this.setState({ status: this.state.mode === 'HOST' ? `Connected to Peer` : `Connected to Host: ${this.state.peerId}` });
        this.dc.onmessage = (event) => this.handleDataChannelMessage(JSON.parse(event.data));
        this.dc.onclose = () => this.disconnect('Data channel closed.');
    }

    async disconnect(reason = 'User disconnected.') {
        this.pc?.close();
        this.ws?.close();
        this.pendingRequests.forEach(p => p.reject(new Error(reason)));
        this.streamPorts.forEach(p => p.disconnect());
        this.pendingRequests.clear();
        this.streamPorts.clear();
        this.pc = null; this.dc = null; this.ws = null;
        this.setState({ mode: 'NONE', status: reason, hostId: null, peerId: null });
    }

    private async handleSignalingMessage(msg: any) {
        switch(msg.type) {
            case 'host-registered': this.setState({ hostId: msg.hostId, status: `Sharing as: ${msg.hostId}` }); break;
            case 'offer':
                this.setState({ peerId: msg.sourceId });
                this.setupPeerConnection(true);
                await this.pc!.setRemoteDescription(new RTCSessionDescription(msg.sdp));
                const answer = await this.pc!.createAnswer();
                await this.pc!.setLocalDescription(answer);
                this.ws?.send(JSON.stringify({ type: 'answer', targetId: msg.sourceId, sdp: answer }));
                break;
            case 'answer': await this.pc?.setRemoteDescription(new RTCSessionDescription(msg.sdp)); break;
            case 'ice-candidate': await this.pc?.addIceCandidate(new RTCIceCandidate(msg.candidate)); break;
            case 'error': this.disconnect(msg.message); break;
        }
    }

    private handleDataChannelMessage(msg: any) {
        if (this.state.mode === 'CLIENT') { // We are receiving a response from the host
            if (msg.isStream) {
                const port = this.streamPorts.get(msg.requestId);
                if (port) {
                    if (msg.payload.type === 'DONE' || msg.payload.type === 'ERROR') {
                        port.postMessage(msg.payload);
                        port.disconnect();
                        this.streamPorts.delete(msg.requestId);
                    } else {
                        port.postMessage(msg.payload);
                    }
                }
            } else {
                const promise = this.pendingRequests.get(msg.requestId);
                if (promise) {
                    if (msg.error) promise.reject(new Error(msg.error));
                    else promise.resolve(msg.payload);
                    this.pendingRequests.delete(msg.requestId);
                }
            }
        } else if (this.state.mode === 'HOST') { // We are receiving a request from the client
            const { requestId, type, endpoint, options, isStream } = msg;
            if (isStream) {
                this.handleStreamRequestOverP2P(requestId, endpoint, options);
            } else {
                queueManager.submitRequest(() => performOllamaFetch(endpoint, options), endpoint, type)
                    .then(payload => this.dc?.send(JSON.stringify({ requestId, payload })))
                    .catch(e => this.dc?.send(JSON.stringify({ requestId, error: e.message })));
            }
        }
    }

    private async handleStreamRequestOverP2P(requestId: string, endpoint: string, options: RequestInit) {
        try {
            const { ollamaEndpoint } = await browser.storage.sync.get("ollamaEndpoint");
            const ollamaBaseUrl = ollamaEndpoint || DEFAULT_OLLAMA_BASE_URL;
            const url = new URL(endpoint, ollamaBaseUrl).href;
            const response = await fetch(url, options);

            if (!response.ok) throw new Error(`Ollama API Error: ${response.status} - ${await response.text()}`);
            if (!response.body) throw new Error("Response body is empty.");
            
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            const processChunk = () => {
                reader.read().then(({ done, value }) => {
                    if (done) {
                        if (buffer.length > 0) {
                            try { this.dc?.send(JSON.stringify({ isStream: true, requestId, payload: { type: 'CHUNK', data: JSON.parse(buffer) } })); } catch(e) {}
                        }
                        this.dc?.send(JSON.stringify({ isStream: true, requestId, payload: { type: 'DONE' } }));
                        return;
                    }
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';
                    for (const line of lines) {
                        if (line.trim() === '') continue;
                        try { this.dc?.send(JSON.stringify({ isStream: true, requestId, payload: { type: 'CHUNK', data: JSON.parse(line) } })); } catch (e) {}
                    }
                    processChunk();
                }).catch(e => {
                    this.dc?.send(JSON.stringify({ isStream: true, requestId, payload: { type: 'ERROR', error: e.message } }));
                });
            };
            processChunk();
        } catch(e: any) {
            this.dc?.send(JSON.stringify({ isStream: true, requestId, payload: { type: 'ERROR', error: e.message } }));
        }
    }

    sendRequest(request: any): Promise<any> {
        return new Promise((resolve, reject) => {
            if (this.state.mode === 'CLIENT' && this.dc?.readyState === 'open') {
                const requestId = `p2p-req-${Date.now()}-${Math.random()}`;
                this.pendingRequests.set(requestId, { resolve, reject });
                this.dc.send(JSON.stringify({ ...request, requestId }));
            } else {
                reject(new Error("Not connected to a peer."));
            }
        });
    }

    handleStreamPort(port: browser.Runtime.Port, msg: any) {
        if (this.state.mode === 'CLIENT' && this.dc?.readyState === 'open') {
            const requestId = `p2p-stream-${Date.now()}-${Math.random()}`;
            this.streamPorts.set(requestId, port);
            port.onDisconnect.addListener(() => this.streamPorts.delete(requestId));
            this.dc.send(JSON.stringify({ ...msg, requestId, isStream: true }));
        } else {
            port.postMessage({ type: 'ERROR', error: 'Not connected to a peer.' });
            port.disconnect();
        }
    }
}
const p2pManager = new P2PManager();
// --- End P2PManager ---


// --- QueueManager ---
class QueueManager {
    private heavyQueue: { task: () => Promise<any>; resolve: (value: any) => void; reject: (reason?: any) => void; }[] = [];
    private lightQueue: { task: () => Promise<any>; resolve: (value: any) => void; reject: (reason?: any) => void; }[] = [];
    private activeHeavyTasks = 0;
    private activeLightTasks = 0;
    private heavyLimit = DEFAULT_HEAVY_CONCURRENCY;
    private lightLimit = DEFAULT_LIGHT_CONCURRENCY;

    constructor() {
        this.loadSettings();
    }
    
    private broadcastStatus() {
        const status = {
            heavy: this.heavyQueue.length,
            light: this.lightQueue.length
        };
        for (const port of popupPorts) {
            port.postMessage({ type: 'queueStatusUpdate', status });
        }
    }

    async loadSettings() {
        const { concurrencySettings } = await browser.storage.sync.get('concurrencySettings');
        this.heavyLimit = concurrencySettings?.heavy ?? DEFAULT_HEAVY_CONCURRENCY;
        this.lightLimit = concurrencySettings?.light ?? DEFAULT_LIGHT_CONCURRENCY;
    }

    async setLimits(limits: { heavy: number; light: number }) {
        this.heavyLimit = limits.heavy > 0 ? limits.heavy : 1;
        this.lightLimit = limits.light > 0 ? limits.light : 1;
        await browser.storage.sync.set({ concurrencySettings: { heavy: this.heavyLimit, light: this.lightLimit } });
        this._processQueues();
    }
    
    getLimits() {
        return { heavy: this.heavyLimit, light: this.lightLimit };
    }

    private classifyRequest(endpoint: string, type?: string): 'heavy' | 'light' {
        if (HEAVY_TYPES.includes(type || '') || HEAVY_ENDPOINTS.includes(endpoint)) {
            return 'heavy';
        }
        return 'light';
    }

    submit<T>(task: () => Promise<T>, type: 'heavy' | 'light'): Promise<T> {
        return new Promise((resolve, reject) => {
            const queue = type === 'heavy' ? this.heavyQueue : this.lightQueue;
            queue.push({ task, resolve, reject });
            this._processQueues();
            this.broadcastStatus();
        });
    }

    submitRequest(task: () => Promise<any>, endpoint: string, type?: string) {
        const queueType = this.classifyRequest(endpoint, type);
        return this.submit(task, queueType);
    }

    clear() {
        const error = new Error("Queue cleared by user.");
        this.heavyQueue.forEach(item => item.reject(error));
        this.lightQueue.forEach(item => item.reject(error));
        this.heavyQueue = [];
        this.lightQueue = [];
        this.broadcastStatus();
    }

    private _processQueues() {
        const process = () => {
            while (this.activeHeavyTasks < this.heavyLimit && this.heavyQueue.length > 0) {
                const item = this.heavyQueue.shift();
                if (!item) continue;
                const { task, resolve, reject } = item;
                
                this.activeHeavyTasks++;
                this.broadcastStatus();

                task().then(resolve).catch(reject).finally(() => {
                    this.activeHeavyTasks--;
                    this._processQueues();
                });
            }

            while (this.activeLightTasks < this.lightLimit && this.lightQueue.length > 0) {
                const item = this.lightQueue.shift();
                if (!item) continue;
                const { task, resolve, reject } = item;

                this.activeLightTasks++;
                this.broadcastStatus();

                task().then(resolve).catch(reject).finally(() => {
                    this.activeLightTasks--;
                    this._processQueues();
                });
            }
        };
        process();
        this.broadcastStatus();
    }
}

const queueManager = new QueueManager();
// --- End QueueManager ---

const performOllamaFetch = async (endpoint: string, options: RequestInit) => {
    const { ollamaEndpoint } = await browser.storage.sync.get("ollamaEndpoint");
    const ollamaBaseUrl = ollamaEndpoint || DEFAULT_OLLAMA_BASE_URL;
    const url = new URL(endpoint, ollamaBaseUrl).href;
    if (options.body && typeof options.body !== 'string') {
        options.body = JSON.stringify(options.body);
    }
    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Ollama API Error: ${response.status} - ${errorText}`);
        }
        if (response.status === 200 && options.method === 'DELETE' && endpoint === '/api/delete') {
            return { success: true };
        }
        const responseText = await response.text();
        try { return { success: true, data: JSON.parse(responseText) }; } catch (e) { return { success: true, data: responseText }; }
    } catch (e: any) {
        if (e.message.includes('Failed to fetch')) {
             return { success: false, error: "Connection to Ollama failed. Ensure Ollama is running and CORS is configured."};
        }
        return { success: false, error: e.message };
    }
};

const handleWebRequest = async (request: any, sender: browser.Runtime.MessageSender) => {
    const p2pState = p2pManager.getState();
    if (p2pState.mode === 'CLIENT' && p2pState.status.startsWith('Connected')) {
        const p2pRequest = {
            type: request.type === 'ollamaRequest' ? 'ollamaRequest' : request.type,
            endpoint: request.type === 'ollamaRequest' ? request.endpoint : `/api/${request.type}`,
            options: request.options || { method: 'POST', body: JSON.stringify(request.params) },
        };
        if (request.type === 'getModels') p2pRequest.options = { method: 'GET' };
        if (request.type === 'delete') p2pRequest.options = { method: 'DELETE', body: JSON.stringify(request.params) };
        return p2pManager.sendRequest(p2pRequest);
    }
    
    if (!sender.url) return { success: false, error: "Sender URL not available." };
    const { allowedDomains = [] } = await browser.storage.sync.get("allowedDomains");
    const senderOrigin = new URL(sender.url).origin;
    const isAllowed = allowedDomains.some((pattern: string) => {
        if (pattern === "*://*/*") return true;
        const simplePattern = pattern.replace(/(\*:\/\/\*|\/\*)/g, '');
        return senderOrigin.includes(simplePattern);
    });
    if (!isAllowed) {
        return { success: false, error: `Unauthorized domain: ${senderOrigin}. Please add it to the extension's allow-list.` };
    }

    const task = () => {
        switch (request.type) {
            case 'testConnection': return performOllamaFetch('/', { method: 'GET' });
            case 'getModels': return performOllamaFetch('/api/tags', { method: 'GET' });
            case 'generate': return performOllamaFetch('/api/generate', { method: 'POST', body: JSON.stringify(request.params) });
            case 'chat': return performOllamaFetch('/api/chat', { method: 'POST', body: JSON.stringify(request.params) });
            case 'pull': return performOllamaFetch('/api/pull', { method: 'POST', body: JSON.stringify(request.params) });
            case 'delete': return performOllamaFetch('/api/delete', { method: 'DELETE', body: JSON.stringify(request.params) });
            case 'ollamaRequest': return performOllamaFetch(request.endpoint, request.options);
            default: return Promise.resolve({ success: false, error: `Unsupported request type: ${request.type}` });
        }
    };
    
    const endpoint = request.type === 'ollamaRequest' ? request.endpoint : `/api/${request.type}`;
    return queueManager.submitRequest(task, endpoint, request.type);
};

const handlePopupRequest = async (request: any) => {
    switch(request.type) {
        case "getDomains": { const { allowedDomains = [] } = await browser.storage.sync.get("allowedDomains"); return { domains: allowedDomains }; }
        case "addDomain": { if (request.domain) { const { allowedDomains = [] } = await browser.storage.sync.get("allowedDomains"); await browser.storage.sync.set({ allowedDomains: [...new Set([...allowedDomains, request.domain])] }); return { success: true }; } break; }
        case "addCurrentDomain": { const tabs = await browser.tabs.query({ active: true, currentWindow: true }); if (tabs[0]?.url) { const domain = new URL(tabs[0].url).origin + "/*"; const { allowedDomains = [] } = await browser.storage.sync.get("allowedDomains"); if (!allowedDomains.includes(domain)) { await browser.storage.sync.set({ allowedDomains: [...allowedDomains, domain] }); } return { success: true }; } break; }
        case "allowAllDomains": { await browser.storage.sync.set({ allowedDomains: ["*://*/*"] }); return { success: true }; }
        case "removeDomain": { const { allowedDomains = [] } = await browser.storage.sync.get("allowedDomains"); await browser.storage.sync.set({ allowedDomains: allowedDomains.filter((d: string) => d !== request.domain) }); return { success: true }; }
        case "setEndpoint": { if (request.endpoint) { await browser.storage.sync.set({ ollamaEndpoint: request.endpoint }); return { success: true }; } break; }
        case "getEndpoint": { const { ollamaEndpoint } = await browser.storage.sync.get("ollamaEndpoint"); return { endpoint: ollamaEndpoint || DEFAULT_OLLAMA_BASE_URL }; }
        case "getLimits": return queueManager.getLimits();
        case "setLimits": { if (request.limits) { await queueManager.setLimits(request.limits); return { success: true }; } break; }
        case "clearQueues": { queueManager.clear(); return { success: true }; }
        case 'fetchModels': {
            const p2pState = p2pManager.getState();
            if (p2pState.mode === 'CLIENT' && p2pState.status.startsWith('Connected')) {
                return p2pManager.sendRequest({ type: 'getModels', endpoint: '/api/tags', options: { method: 'GET' } });
            }
            return queueManager.submit(() => performOllamaFetch('/api/tags', { method: 'GET' }), 'light');
        }
        case 'deleteModel': {
            if (request.model) {
                const p2pState = p2pManager.getState();
                if (p2pState.mode === 'CLIENT' && p2pState.status.startsWith('Connected')) {
                    return p2pManager.sendRequest({ type: 'delete', endpoint: '/api/delete', options: { method: 'DELETE', body: JSON.stringify({ name: request.model }) }});
                }
                return queueManager.submit(() =>
                    performOllamaFetch('/api/delete', { method: 'DELETE', body: JSON.stringify({ name: request.model }) }), 'light');
            }
            return { success: false, error: "Model name not provided." };
        }
        case 'p2p_get_status': return p2pManager.getState();
        case 'p2p_start_hosting': p2pManager.startHosting(); return { success: true };
        case 'p2p_connect': p2pManager.connectToPeer(request.peerId); return { success: true };
        case 'p2p_disconnect': p2pManager.disconnect(); return { success: true };
    }
};

browser.runtime.onMessage.addListener(async (request, sender) => {
    try {
        if (sender.tab && sender.url) {
            return await handleWebRequest(request, sender);
        } else {
            return await handlePopupRequest(request);
        }
    } catch (e: any) {
        return { success: false, error: e.message };
    }
});

browser.runtime.onConnect.addListener((port) => {
    if (port.name === "popup-status-port") {
        popupPorts.add(port);
        port.onDisconnect.addListener(() => {
            popupPorts.delete(port);
        });
        port.postMessage({ type: 'p2pStatusUpdate', state: p2pManager.getState() });
        return;
    }

    if (port.name !== 'ollama-stream') return;

    const streamToPort = async (endpoint: string, options: RequestInit, p: browser.Runtime.Port) => {
        const { ollamaEndpoint } = await browser.storage.sync.get("ollamaEndpoint");
        const ollamaBaseUrl = ollamaEndpoint || DEFAULT_OLLAMA_BASE_URL;
        const url = new URL(endpoint, ollamaBaseUrl).href;

        try {
            const response = await fetch(url, options);
            if (!response.ok) throw new Error(`Ollama API Error: ${response.status} - ${await response.text()}`);
            if (!response.body) throw new Error("Response body is empty.");

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    if (buffer.length > 0) {
                        try { p.postMessage({ type: 'CHUNK', data: JSON.parse(buffer) }); } catch(e) { console.warn("Ollama-web: Unparsable final chunk ignored", buffer); }
                    }
                    break;
                }

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (line.trim() === '') continue;
                    try { p.postMessage({ type: 'CHUNK', data: JSON.parse(line) }); } catch (e) { console.warn("Ollama-web: Non-JSON chunk ignored", line); }
                }
            }
            p.postMessage({ type: 'DONE' });
        } catch (e: any) {
            const errorMsg = e.message.includes('Failed to fetch') ? "Connection to Ollama failed. Ensure Ollama is running and CORS is configured." : e.message;
            p.postMessage({ type: 'ERROR', error: errorMsg });
        } finally {
            p.disconnect();
        }
    };
    
    port.onMessage.addListener(async (msg) => {
        const p2pState = p2pManager.getState();
        if (p2pState.mode === 'CLIENT' && p2pState.status.startsWith('Connected')) {
            const p2pRequest = { type: msg.type, endpoint: msg.endpoint, options: { method: 'POST', body: JSON.stringify(msg.params) }};
            p2pManager.handleStreamPort(port, p2pRequest);
            return;
        }

        if (port.sender?.tab && port.sender?.url) {
            const { allowedDomains = [] } = await browser.storage.sync.get("allowedDomains");
            const senderOrigin = new URL(port.sender.url).origin;
            const isAllowed = allowedDomains.some((pattern: string) => {
                if (pattern === "*://*/*") return true;
                const simplePattern = pattern.replace(/(\*:\/\/\*|\/\*)/g, '');
                return senderOrigin.includes(simplePattern);
            });
            if (!isAllowed) {
                port.postMessage({ type: 'ERROR', error: `Unauthorized domain for streaming: ${senderOrigin}.` });
                port.disconnect();
                return;
            }
        }
        
        if (msg.type === 'streamRequest' && msg.endpoint) {
             const options = {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(msg.params)
            };
            queueManager.submit(() => streamToPort(msg.endpoint, options, port), 'heavy');
        }
    });
});