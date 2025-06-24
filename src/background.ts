import browser from "webextension-polyfill";

const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

// --- Shared Logic ---

const performOllamaFetch = async (endpoint: string, options: RequestInit) => {
    const { ollamaEndpoint } = await browser.storage.sync.get("ollamaEndpoint");
    const ollamaBaseUrl = ollamaEndpoint || DEFAULT_OLLAMA_BASE_URL;
    const url = new URL(endpoint, ollamaBaseUrl).href;
    
    // The body from the web app might already be a stringified JSON
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
        try { 
            return { success: true, data: JSON.parse(responseText) }; 
        } catch (e) { 
            return { success: true, data: responseText }; 
        }
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
        const popupUrl = browser.runtime.getURL("popup.html");
        const tabs = await browser.tabs.query({ url: popupUrl });

        if (tabs.length === 0) {
            browser.windows.create({
                url: popupUrl,
                type: "popup",
                width: 420,
                height: 600,
            });
        }
        return { success: false, error: `Unauthorized domain: ${senderOrigin}. Please add it to the extension's allow-list.` };
    }

    // Handle high-level commands
    switch (request.type) {
        case 'testConnection':
            return performOllamaFetch('/', { method: 'GET' });
        case 'getModels':
            return performOllamaFetch('/api/tags', { method: 'GET' });
        case 'generate':
            return performOllamaFetch('/api/generate', { method: 'POST', body: JSON.stringify(request.params) });
        case 'ollamaRequest':
            return performOllamaFetch(request.endpoint, request.options);
        default:
            return { success: false, error: `Unsupported request type: ${request.type}` };
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
        case 'sendToOllama': {
            const options = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: request.model, prompt: request.prompt, stream: false }) };
            return performOllamaFetch('/api/generate', options);
        }
    }
};


// --- Listeners ---

browser.runtime.onMessage.addListener(async (request, sender) => {
    try {
        if (sender.tab && sender.url) {
            // Message from a content script
            return await handleWebRequest(request, sender);
        } else {
            // Message from the popup
            return await handlePopupRequest(request);
        }
    } catch (e: any) {
        return { success: false, error: e.message };
    }
});