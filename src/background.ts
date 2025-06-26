import browser from "webextension-polyfill";

const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

// --- Shared Logic (No Changes) ---
const performOllamaFetch = async (endpoint: string, options: RequestInit) => {
    // ... (This function is unchanged)
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
    // ... (This function is unchanged)
    if (!sender.url) return { success: false, error: "Sender URL not available." };
    const { allowedDomains = [] } = await browser.storage.sync.get("allowedDomains");
    const senderOrigin = new URL(sender.url).origin;
    const isAllowed = allowedDomains.some((pattern: string) => {
        if (pattern === "*://*/*") return true;
        const simplePattern = pattern.replace(/(\*:\/\/\*|\/\*)/g, '');
        return senderOrigin.includes(simplePattern);
    });
    if (!isAllowed) {
        const popupUrl = browser.runtime.getURL("popup.html");
        const tabs = await browser.tabs.query({ url: popupUrl });
        if (tabs.length === 0) {
            browser.windows.create({ url: popupUrl, type: "popup", width: 420, height: 600 });
        }
        return { success: false, error: `Unauthorized domain: ${senderOrigin}. Please add it to the extension's allow-list.` };
    }
    switch (request.type) {
        case 'testConnection': return performOllamaFetch('/', { method: 'GET' });
        case 'getModels': return performOllamaFetch('/api/tags', { method: 'GET' });
        case 'generate': return performOllamaFetch('/api/generate', { method: 'POST', body: JSON.stringify(request.params) });
        case 'ollamaRequest': return performOllamaFetch(request.endpoint, request.options);
        default: return { success: false, error: `Unsupported request type: ${request.type}` };
    }
};

const handlePopupRequest = async (request: any) => {
    // ... (This function is unchanged)
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
        case 'sendToOllama':
             if (request.params?.stream === true) {
                return { success: false, error: "Streaming is not supported through this message type." };
            }
            const options = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: request.model, prompt: request.prompt, stream: false }) };
            return performOllamaFetch('/api/generate', options);
    }
};

// --- Listeners (No Changes) ---
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


// --- Streaming Connection Listener ---

browser.runtime.onConnect.addListener((port) => {
    if (port.name !== 'ollama-stream') return;

    // --- THIS IS THE FIX ---
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
            let buffer = ''; // The line buffer

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    // If there's anything left in the buffer when the stream is done, process it.
                    if (buffer.length > 0) {
                        try {
                            p.postMessage({ type: 'CHUNK', data: JSON.parse(buffer) });
                        } catch(e) {
                            console.warn("Ollama-web: Unparsable final chunk ignored", buffer);
                        }
                    }
                    break;
                }
                
                // Add the new data to our buffer
                buffer += decoder.decode(value, { stream: true });
                
                // Process all complete lines in the buffer
                const lines = buffer.split('\n');
                // The last item in the array might be an incomplete line, so we keep it in the buffer
                buffer = lines.pop() || ''; 
                
                for (const line of lines) {
                    if (line.trim() === '') continue;
                    try {
                        p.postMessage({ type: 'CHUNK', data: JSON.parse(line) });
                    } catch (e) {
                        console.warn("Ollama-web: Non-JSON chunk ignored", line);
                    }
                }
            }
            p.postMessage({ type: 'DONE' });
        } catch (e: any) {
            const errorMsg = e.message.includes('Failed to fetch')
                ? "Connection to Ollama failed. Ensure Ollama is running and CORS is configured."
                : e.message;
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
        
        if (msg.type === 'streamOllama') {
             const options = {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(msg.params)
            };
            await streamToPort('/api/generate', options, port);
        }
    });
});