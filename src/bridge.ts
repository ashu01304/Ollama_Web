declare global {
    interface Window {
        ollama: {
            request: (endpoint: string, options: RequestInit) => Promise<any>;
        };
    }
}

window.ollama = {
    request: (endpoint: string, options: RequestInit) => {
        return new Promise((resolve) => {
            const requestId = `ollama-request-${Date.now()}-${Math.random()}`;

            const detail = {
                type: 'ollamaRequest',
                endpoint,
                options: {
                    method: options.method,
                    headers: options.headers,
                    body: options.body,
                },
            };

            const listener = (event: MessageEvent) => {
                if (event.source === window && event.data &&
                    event.data.direction === "extension-to-formstr" &&
                    event.data.requestId === requestId) {

                    window.removeEventListener("message", listener);
                    resolve(event.data.message);
                }
            };

            window.addEventListener("message", listener);

            window.postMessage({
                direction: "formstr-to-extension",
                message: detail,
                requestId: requestId
            }, "*");
        });
    }
};

export {};