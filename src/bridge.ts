declare global {
    interface Window {
        ollama: {
            request: (endpoint: string, options: RequestInit) => Promise<any>;
            getModels: () => Promise<any>;
            generate: (params: any, onData?: (chunk: any) => void) => Promise<any>;
            // ADDED: New helper functions
            chat: (params: any, onData?: (chunk: any) => void) => Promise<any>;
            pull: (params: any, onData?: (chunk: any) => void) => Promise<any>;
            delete: (params: any) => Promise<any>;
            testConnection: () => Promise<any>;
        };
    }
}

// Function for single request/response (non-streaming)
const sendOllamaMessage = (message: any): Promise<any> => {
    return new Promise((resolve) => {
        const requestId = `ollama-request-${Date.now()}-${Math.random()}`;
        const listener = (event: MessageEvent) => {
            if (event.source === window && event.data && event.data.direction === "extension-to-page" && event.data.requestId === requestId) {
                window.removeEventListener("message", listener);
                resolve(event.data.message);
            }
        };
        window.addEventListener("message", listener);
        window.postMessage({ direction: "page-to-extension", message: message, requestId: requestId }, "*");
    });
};

// Function to handle streaming communication
const handleOllamaStream = (message: any, onData: (chunk: any) => void): Promise<void> => {
    return new Promise((resolve, reject) => {
        const requestId = `ollama-stream-${Date.now()}-${Math.random()}`;
        const listener = (event: MessageEvent) => {
            if (event.source === window && event.data && event.data.direction === "extension-to-page" && event.data.requestId === requestId) {
                const msg = event.data.message;
                if (msg.type === 'CHUNK') onData(msg.data);
                else if (msg.type === 'DONE') { window.removeEventListener("message", listener); resolve(); }
                else if (msg.type === 'ERROR') { window.removeEventListener("message", listener); reject(new Error(msg.error)); }
                else if (msg.type === 'DISCONNECTED') { window.removeEventListener("message", listener); resolve(); }
            }
        };
        window.addEventListener("message", listener);
        window.postMessage({ direction: "page-to-extension", message: message, requestId: requestId }, "*");
    });
};

window.ollama = {
    // Low-level request (remains non-streaming)
    request: (endpoint: string, options: RequestInit) => {
        return sendOllamaMessage({
            type: 'ollamaRequest',
            endpoint: endpoint,
            options: { method: options.method, headers: options.headers, body: options.body },
        });
    },

    // High-level functions for common tasks
    getModels: () => sendOllamaMessage({ type: 'getModels' }),
    
    // MODIFIED: generate now specifies its endpoint for the generic streaming handler
    generate: (params: any, onData?: (chunk: any) => void) => {
        const message = { type: 'generate', endpoint: '/api/generate', params: params };
        if (params.stream && onData) {
            return handleOllamaStream(message, onData);
        } else {
            return sendOllamaMessage(message);
        }
    },

    // ADDED: New helper for the /api/chat endpoint
    chat: (params: any, onData?: (chunk: any) => void) => {
        const message = { type: 'chat', endpoint: '/api/chat', params: params };
        if (params.stream && onData) {
            return handleOllamaStream(message, onData);
        } else {
            return sendOllamaMessage(message);
        }
    },

    // ADDED: New helper for the /api/pull endpoint
    pull: (params: any, onData?: (chunk: any) => void) => {
        // stream is implicitly true when onData is provided, matching Ollama's behavior
        const isStreaming = typeof onData === 'function';
        const message = { type: 'pull', endpoint: '/api/pull', params: { ...params, stream: isStreaming } };
        
        if (isStreaming) {
            return handleOllamaStream(message, onData);
        } else {
            return sendOllamaMessage(message);
        }
    },

    // ADDED: New helper for the /api/delete endpoint
    delete: (params: any) => {
        return sendOllamaMessage({ type: 'delete', endpoint: '/api/delete', params: params });
    },
    
    testConnection: () => sendOllamaMessage({ type: 'testConnection' })
};

export {};