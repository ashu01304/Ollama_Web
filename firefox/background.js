// Universal API Polyfill
if (typeof browser === "undefined") {
    var browser = chrome;
}

const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

const performOllamaFetch = async (endpoint, options) => {
    const data = await browser.storage.sync.get("ollamaEndpoint");
    const ollamaBaseUrl = data.ollamaEndpoint || DEFAULT_OLLAMA_BASE_URL;
    const url = new URL(endpoint, ollamaBaseUrl).href;

    if (options.body && typeof options.body !== 'string') {
        options.body = JSON.stringify(options.body);
    }
    
    const response = await fetch(url, options);
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! Status: ${response.status}, Message: ${errorText}`);
    }
    const responseText = await response.text();
    try { return { success: true, data: JSON.parse(responseText) }; }
    catch (e) { return { success: true, data: responseText }; }
};

browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // --- Logic for requests from web pages ---
    if (sender.tab) {
        browser.storage.sync.get("allowedDomains").then(data => {
            const allowedDomains = data.allowedDomains || [];
            const senderOrigin = new URL(sender.url).origin;
            const isAllowed = allowedDomains.includes("*://*/*") || allowedDomains.some(pattern => senderOrigin.startsWith(pattern.replace('/*', '')));
            
            if (!isAllowed) {
                sendResponse({ success: false, error: `Unauthorized domain: ${senderOrigin}` });
                return;
            }

            if (request.type === 'ollamaRequest') {
                performOllamaFetch(request.endpoint, request.options)
                    .then(sendResponse)
                    .catch(err => sendResponse({ success: false, error: err.message }));
            }
        });
        return true;
    }
    
    // --- Logic for requests from the popup ---
    const handlePopupRequest = async () => {
        let data = await browser.storage.sync.get("allowedDomains");
        let currentDomains = data.allowedDomains || [];
        switch(request.type) {
            case "getDomains": return { domains: currentDomains };
            case "addDomain": if (request.domain) { await browser.storage.sync.set({ allowedDomains: [...currentDomains, request.domain] }); return { success: true }; } break;
            case "addCurrentDomain": const tabs = await browser.tabs.query({ active: true, currentWindow: true }); if (tabs[0]?.url) { const domain = new URL(tabs[0].url).origin + "/*"; if (!currentDomains.includes(domain)) { await browser.storage.sync.set({ allowedDomains: [...currentDomains, domain] }); } return { success: true }; } break;
            case "allowAllDomains": await browser.storage.sync.set({ allowedDomains: ["*://*/*"] }); return { success: true }; break;
            case "removeDomain": await browser.storage.sync.set({ allowedDomains: currentDomains.filter(d => d !== request.domain) }); return { success: true }; break;
            case "setEndpoint": if (request.endpoint) { await browser.storage.sync.set({ ollamaEndpoint: request.endpoint }); return { success: true }; } break;
            case "getEndpoint": const endpointData = await browser.storage.sync.get("ollamaEndpoint"); return { endpoint: endpointData.ollamaEndpoint || DEFAULT_OLLAMA_BASE_URL }; break;
            case 'fetchModels': return performOllamaFetch('/api/tags', { method: 'GET' });
            case 'sendToOllama': const options = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model: request.model, prompt: request.prompt, stream: false }) }; return performOllamaFetch('/api/generate', options);
        }
    };
    handlePopupRequest().then(sendResponse);
    return true;
});