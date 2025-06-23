declare global {
    interface Window {
        ollama: {
            request: (endpoint: string, options: RequestInit) => Promise<any>;
            getModels: () => Promise<any>;
            generate: (params: any) => Promise<any>;
            testConnection: () => Promise<any>;
        };
    }
}

const sendOllamaMessage = (message: any): Promise<any> => {
    return new Promise((resolve) => {
        const requestId = `ollama-request-${Date.now()}-${Math.random()}`;

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
            message: message,
            requestId: requestId
        }, "*");
    });
};

window.ollama = {
    // Low-level request for advanced use
    request: (endpoint: string, options: RequestInit) => {
        return sendOllamaMessage({
            type: 'ollamaRequest',
            endpoint: endpoint,
            options: {
                method: options.method,
                headers: options.headers,
                body: options.body,
            },
        });
    },

    // High-level functions for common tasks
    getModels: () => {
        return sendOllamaMessage({ type: 'getModels' });
    },
    
    generate: (params: any) => {
        return sendOllamaMessage({ type: 'generate', params: params });
    },
    
    testConnection: () => {
        return sendOllamaMessage({ type: 'testConnection' });
    }
};

export {};