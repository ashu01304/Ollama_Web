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

    const requestId = event.data.requestId;

    // Forward the message to the background script
    browser.runtime.sendMessage(event.data.message)
        .then(response => {
            // Send the response back to the injected script, including the original requestId
            window.postMessage({
                direction: "extension-to-formstr",
                message: response,
                requestId: requestId
            }, "*");
        })
        .catch(error => {
            // Send an error response back if something goes wrong
            const errorResponse = { success: false, error: error.message };
            window.postMessage({
                direction: "extension-to-formstr",
                message: errorResponse,
                requestId: requestId
            }, "*");
        });
});