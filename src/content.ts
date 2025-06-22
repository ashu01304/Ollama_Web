import browser from "webextension-polyfill";

const script = document.createElement('script');
script.src = browser.runtime.getURL('js/bridge.bundle.js');
(document.head || document.documentElement).appendChild(script);

window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.direction !== "formstr-to-extension") {
        return;
    }

    const requestId = event.data.requestId;
    browser.runtime.sendMessage(event.data.message)
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
});