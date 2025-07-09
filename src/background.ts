import browser from "webextension-polyfill";

const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
const DEFAULT_HEAVY_CONCURRENCY = 1;
const DEFAULT_LIGHT_CONCURRENCY = 2;

const HEAVY_ENDPOINTS = ['/api/generate', '/api/chat', '/api/pull'];
const HEAVY_TYPES = ['generate', 'chat', 'pull', 'streamRequest'];

let popupPorts = new Set<browser.Runtime.Port>();

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
        case 'fetchModels': return queueManager.submit(() => performOllamaFetch('/api/tags', { method: 'GET' }), 'light');
        case 'deleteModel': {
            if (request.model) {
                return queueManager.submit(() =>
                    performOllamaFetch('/api/delete', { method: 'DELETE', body: JSON.stringify({ name: request.model }) }), 'light');
            }
            return { success: false, error: "Model name not provided." };
        }
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