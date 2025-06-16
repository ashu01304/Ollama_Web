const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434';

const handleOllamaRequest = (request, sendResponse) => {
    let endpoint = '/api/generate';
    let options = {};

    if (request.type === 'fetchModels') {
        endpoint = '/api/tags';
        options = { method: 'GET' };
    } else if (request.type === 'ollamaRequest') { 
        endpoint = request.endpoint;
        options = request.options;
    } else if (['pullModel', 'deleteModel', 'showModel', 'chat'].includes(request.type)) {
        const endpointMap = {
            pullModel: '/api/pull',
            deleteModel: '/api/delete',
            showModel: '/api/show',
            chat: '/api/chat'
        };
        endpoint = endpointMap[request.type];
        options = {
            method: request.options?.method || 'POST',
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request.options?.body || { model: request.model || "llama3.1:latest" })
        };
    } else { 
        options = {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: request.model || "llama3.1:latest",
                prompt: request.prompt,
                stream: false,
            }),
        };
    }

    let ollamaBaseUrl = DEFAULT_OLLAMA_BASE_URL;
    chrome.storage.sync.get("ollamaEndpoint", (data) => {
      if (data.ollamaEndpoint) {
        ollamaBaseUrl = data.ollamaEndpoint;
      }
      const url = new URL(endpoint, ollamaBaseUrl).href;
      console.log("Ollama Extension: Forwarding request to", url);

      fetch(url, {
        method: options.method,
        headers: options.headers,
        body: options.body,
      })
        .then(response => {
          if (!response.ok) {
            return response.text().then(text => {
              throw new Error(`HTTP error! Status: ${response.status}, Message: ${text}`);
            });
          }
          // The root endpoint returns plain text, not JSON
          return endpoint === '/' ? response.text() : response.json();
        })
        .then(data => sendResponse({ success: true, data: data }))
        .catch(error => {
          // This block now gracefully handles network errors (like "Failed to fetch")
          // console.error("Ollama connection error:", error.message);
          sendResponse({ success: false, error: `Failed to connect to Ollama. Is it running? (${error.message})` });
        });
    });
    // This is crucial for asynchronous sendResponse calls within a callback
    return true; 
};

// --- Domain management ---
const defaultDomains = [];
let allowedDomains = [];

chrome.storage.sync.get("allowedDomains", (data) => {
  allowedDomains = data.allowedDomains || defaultDomains;
});

function updateDomains(domains, callback) {
  allowedDomains = domains;
  chrome.storage.sync.set({ allowedDomains }, () => {
    if (callback) callback();
  });
}

// --- Listener for EXTERNAL messages (from web apps) ---
chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  const senderOrigin = sender.url ? new URL(sender.url).origin + "/*" : "";
  if (!allowedDomains.includes("*://*/*") && !allowedDomains.includes(senderOrigin)) {
    sendResponse({ success: false, error: "Unauthorized domain" });
    return true;
  }
  handleOllamaRequest(request, sendResponse);
  return true; // Indicates async response
});

// --- Listener for INTERNAL messages (from the popup) ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "getDomains") {
    sendResponse({ domains: allowedDomains });
  } else if (request.type === "addDomain") {
    const domainPattern = /^(\*:\/\/)?([*a-zA-Z0-9.-]+)(\/\*)?$/;
    if (request.domain && domainPattern.test(request.domain)) {
      if (!allowedDomains.includes(request.domain)) {
        updateDomains([...allowedDomains, request.domain], () => sendResponse({ success: true }));
      } else {
        sendResponse({ success: true });
      }
    } else {
      sendResponse({ success: false, error: "Invalid domain format" });
    }
  } else if (request.type === "addCurrentDomain") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) {
        const domain = new URL(tabs[0].url).origin + "/*";
        if (!allowedDomains.includes(domain)) {
          updateDomains([...allowedDomains, domain], () => sendResponse({ success: true }));
        } else {
          sendResponse({ success: true });
        }
      } else {
        sendResponse({ success: false, error: "No active tab URL" });
      }
    });
  } else if (request.type === "allowAllDomains") {
    updateDomains(["*://*/*"], () => sendResponse({ success: true }));
  } else if (request.type === "removeDomain") {
    updateDomains(allowedDomains.filter(d => d !== request.domain), () => sendResponse({ success: true }));
  } else if (request.type === "setEndpoint") {
    const endpointPattern = /^https?:\/\/[a-zA-Z0-9.-]+(:[0-9]+)?$/;
    if (request.endpoint && endpointPattern.test(request.endpoint)) {
      chrome.storage.sync.set({ ollamaEndpoint: request.endpoint }, () => sendResponse({ success: true }));
    } else {
      sendResponse({ success: false, error: "Invalid endpoint format (e.g., http://localhost:11434)" });
    }
  } else if (request.type === "getEndpoint") {
    chrome.storage.sync.get("ollamaEndpoint", (data) => {
      sendResponse({ endpoint: data.ollamaEndpoint || DEFAULT_OLLAMA_BASE_URL });
    });
  } else {
    // This handles fetchModels, ollamaRequest, and other direct requests
    handleOllamaRequest(request, sendResponse);
  }
  return true; // Indicates async response for all branches
});