window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data.direction !== "formstr-to-extension") {
        return;
    }
    console.log("[ContentScript] Received message from page:", event.data.message);
    browser.runtime.sendMessage(event.data.message)
        .then(response => {
            console.log("[ContentScript] Received response from background:", response);
            window.postMessage({ direction: "extension-to-formstr", message: response }, "*");
        })
        .catch(error => {
            console.error("[ContentScript] Error:", error);
            window.postMessage({ direction: "extension-to-formstr", message: { success: false, error: error.message } }, "*");
        });
});