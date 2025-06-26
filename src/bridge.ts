declare global {
    interface Window {
        ollama: {
            request: (endpoint: string, options: RequestInit) => Promise<any>;
            getModels: () => Promise<any>;
            // UPDATED: generate now supports an optional streaming callback
            generate: (params: any, onData?: (chunk: any) => void) => Promise<any>;
            testConnection: () => Promise<any>;
        };
    }
}

// Function for single request/response (non-streaming)
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

// --- NEW: Function to handle streaming communication ---
const handleOllamaStream = (message: any, onData: (chunk: any) => void): Promise<void> => {
    return new Promise((resolve, reject) => {
        const requestId = `ollama-stream-${Date.now()}-${Math.random()}`;

        const listener = (event: MessageEvent) => {
            if (event.source === window && event.data &&
                event.data.direction === "extension-to-formstr" &&
                event.data.requestId === requestId) {

                const msg = event.data.message;
                
                if (msg.type === 'CHUNK') {
                    onData(msg.data); // Pass the data chunk to the callback
                } else if (msg.type === 'DONE') {
                    window.removeEventListener("message", listener);
                    resolve(); // The stream is successfully finished
                } else if (msg.type === 'ERROR') {
                    window.removeEventListener("message", listener);
                    reject(new Error(msg.error)); // The stream ended with an error
                } else if (msg.type === 'DISCONNECTED') {
                    // This is a final cleanup message
                    window.removeEventListener("message", listener);
                    resolve();
                }
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
    // Low-level request (remains non-streaming)
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
    
    // UPDATED: generate now routes to the correct handler
    generate: (params: any, onData?: (chunk: any) => void) => {
        const message = { type: 'generate', params: params };
        if (params.stream && onData) {
            // Use the new streaming handler
            return handleOllamaStream(message, onData);
        } else {
            // Use the old promise-based handler for non-streaming
            return sendOllamaMessage(message);
        }
    },
    
    testConnection: () => {
        return sendOllamaMessage({ type: 'testConnection' });
    }
};

export {};