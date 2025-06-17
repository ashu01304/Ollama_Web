import browser from "webextension-polyfill";

window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.direction !== "formstr-to-extension") {
        return;
    }
    browser.runtime.sendMessage(event.data.message)
        .then(response => {
            window.postMessage({ direction: "extension-to-formstr", message: response }, "*");
        })
        .catch(error => {
            window.postMessage({ direction: "extension-to-formstr", message: { success: false, error: error.message } }, "*");
        });
});