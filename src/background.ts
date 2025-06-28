import browser from "webextension-polyfill";

const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

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
        
        // --- FIX 1 ---
        // Correctly check for a DELETE method on success.
        // Ollama returns 200 OK with no body for a successful delete.
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

    switch (request.type) {
        case 'testConnection': return performOllamaFetch('/', { method: 'GET' });
        case 'getModels': return performOllamaFetch('/api/tags', { method: 'GET' });
        case 'generate': return performOllamaFetch('/api/generate', { method: 'POST', body: JSON.stringify(request.params) });
        case 'chat': return performOllamaFetch('/api/chat', { method: 'POST', body: JSON.stringify(request.params) });
        case 'pull': return performOllamaFetch('/api/pull', { method: 'POST', body: JSON.stringify(request.params) });
        
        // --- FIX 2 ---
        // Use the DELETE method for the developer API helper.
        case 'delete': return performOllamaFetch('/api/delete', { method: 'DELETE', body: JSON.stringify(request.params) });
        
        case 'ollamaRequest': return performOllamaFetch(request.endpoint, request.options);
        default: return { success: false, error: `Unsupported request type: ${request.type}` };
    }
};

const handlePopupRequest = async (request: any) => {
    switch(request.type) {
        case "getDomains": {
            const { allowedDomains = [] } = await browser.storage.sync.get("allowedDomains");
            return { domains: allowedDomains };
        }
        case "addDomain": {
            if (request.domain) {
                const { allowedDomains = [] } = await browser.storage.sync.get("allowedDomains");
                await browser.storage.sync.set({ allowedDomains: [...new Set([...allowedDomains, request.domain])] });
                return { success: true };
            }
            break;
        }
        case "addCurrentDomain": {
            const tabs = await browser.tabs.query({ active: true, currentWindow: true });
            if (tabs[0]?.url) {
                const domain = new URL(tabs[0].url).origin + "/*";
                const { allowedDomains = [] } = await browser.storage.sync.get("allowedDomains");
                if (!allowedDomains.includes(domain)) {
                    await browser.storage.sync.set({ allowedDomains: [...allowedDomains, domain] });
                }
                return { success: true };
            }
            break;
        }
        case "allowAllDomains": {
            await browser.storage.sync.set({ allowedDomains: ["*://*/*"] });
            return { success: true };
        }
        case "removeDomain": {
            const { allowedDomains = [] } = await browser.storage.sync.get("allowedDomains");
            await browser.storage.sync.set({ allowedDomains: allowedDomains.filter((d: string) => d !== request.domain) });
            return { success: true };
        }
        case "setEndpoint": {
            if (request.endpoint) {
                await browser.storage.sync.set({ ollamaEndpoint: request.endpoint });
                return { success: true };
            }
            break;
        }
        case "getEndpoint": {
            const { ollamaEndpoint } = await browser.storage.sync.get("ollamaEndpoint");
            return { endpoint: ollamaEndpoint || DEFAULT_OLLAMA_BASE_URL };
        }
        case 'fetchModels':
            return performOllamaFetch('/api/tags', { method: 'GET' });
        
        case 'deleteModel': {
            if (request.model) {
                // --- FIX 3 ---
                // Use the DELETE method for the popup UI.
                return performOllamaFetch('/api/delete', { method: 'DELETE', body: JSON.stringify({ name: request.model }) });
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
                // NOTE: All current streaming endpoints use POST. If a future one uses a different
                // method, this would need to be passed in the message.
                method: "POST", 
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(msg.params)
            };
            await streamToPort(msg.endpoint, options, port);
        }
    });
});