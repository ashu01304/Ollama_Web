import browser from "webextension-polyfill";

// Inject the bridge script into the web page
const script = document.createElement('script');
script.src = browser.runtime.getURL('js/bridge.bundle.js');
(document.head || document.documentElement).appendChild(script);

// Listen for messages from the injected script (window.postMessage)
window.addEventListener("message", (event) => {
    // Only accept messages from the window, with the correct direction
    if (event.source !== window || !event.data || event.data.direction !== "formstr-to-extension") {
        return;
    }

    const request = event.data.message;
    const requestId = event.data.requestId;

    // --- Streaming vs. Non-Streaming Logic ---
    const isStreaming = request.params?.stream === true;

    if (isStreaming) {
        const port = browser.runtime.connect({ name: 'ollama-stream' });
        port.onMessage.addListener((msg) => {
            window.postMessage({
                direction: "extension-to-formstr",
                message: msg, // Forward the raw chunk, done, or error message
                requestId: requestId
            }, "*");
        });

        port.onDisconnect.addListener(() => {
            // Ensure a final message is sent so the page knows the stream is over
            const finalMsg = { type: 'DISCONNECTED' };
            window.postMessage({
                direction: "extension-to-formstr",
                message: finalMsg,
                requestId: requestId
            }, "*");
        });
        port.postMessage({
            type: "streamOllama",
            params: request.params
        });

    } else {
        browser.runtime.sendMessage(request)
            .then(response => {
                window.postMessage({
                    direction: "extension-to-formstr",
                    message: response,
                    requestId: requestId
                }, "*");
            })
            .catch(error => {
                const errorResponse = { success: false, error: error.message };
                window.postMessage({
                    direction: "extension-to-formstr",
                    message: errorResponse,
                    requestId: requestId
                }, "*");
            });
    }
});