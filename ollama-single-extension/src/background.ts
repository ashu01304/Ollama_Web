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
    
    const response = await fetch(url, options);
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! Status: ${response.status}, Message: ${errorText}`);
    }
    const responseText = await response.text();
    try { 
        return { success: true, data: JSON.parse(responseText) }; 
    } catch (e) { 
        return { success: true, data: responseText }; 
    }
};

const handleWebRequest = async (request: any, sender: browser.Runtime.MessageSender) => {
    if (!sender.url) return { success: false, error: "Sender URL not available." };

    const { allowedDomains = [] } = await browser.storage.sync.get("allowedDomains");
    const senderOrigin = new URL(sender.url).origin;
    const isAllowed = allowedDomains.includes("*://*/*") || allowedDomains.some((pattern: string) => senderOrigin.startsWith(pattern.replace('/*', '')));
            
    if (!isAllowed) {
        return { success: false, error: `Unauthorized domain: ${senderOrigin}` };
    }

    if (request.type === 'ollamaRequest') {
        return performOllamaFetch(request.endpoint, request.options);
    }
    return { success: false, error: `Unsupported request type from web page: ${request.type}` };
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

// This listener handles direct messages from web pages (Primarily for Chrome)
browser.runtime.onMessageExternal.addListener(async (request, sender) => {
    try {
        const response = await handleWebRequest(request, sender);
        return response;
    } catch (e: any) {
        return { success: false, error: e.message };
    }
});

// This listener handles messages from within the extension (popup, and content script for Firefox)
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