# Privacy Policy for Ollama Web Extension

**Effective Date:** [july 1, 2025]

Thank you for using the Ollama Web Extension. Your privacy is our top priority. This extension is designed to be a secure, local-first tool that acts as a proxy between your web browser and your own local Ollama instance.

This policy outlines what information the extension handles and, more importantly, what it does not.

### Our Privacy Philosophy

The core principle of this extension is privacy by design. We **do not** operate any external servers, and we **do not** collect, store, view, or transmit your personal data or AI interactions. The extension is a bridge that runs entirely on your computer.

### Information We Store

To function correctly, the extension stores a small amount of configuration data directly in your browser. This data includes:

* **Ollama Endpoint URL:** The address of your local Ollama server (e.g., `http://127.0.0.1:11434`).
* **Allowed Domains:** The list of websites you have explicitly granted permission to use the extension.
* **Concurrency Limits:** The number of parallel heavy and light tasks you have configured in the advanced settings.

#### Where is this information stored?

This configuration data is saved using the browser's `storage.sync` API. This means the data is:

1. Stored locally on your machine.
2. Potentially synced across your devices if you are logged into a browser account (e.g., a Google or Firefox account). This syncing is handled by the browser vendor (Google/Mozilla), not by our extension.

### Information We Process

When you or an allowed website makes a request to Ollama through the extension, the following data is processed **in-transit**:

* Prompts, model names, and any other parameters sent to the Ollama API.

This information is passed directly from the webpage, through the extension, to your local Ollama server. The extension **does not permanently store** your prompts, the model's responses, or your chat history. This data is handled ephemerally to fulfill the request.

### Information We DO NOT Collect

To be perfectly clear, we **never** collect, store, or have access to:

* Your personal information (name, email address, etc.).
* Your browsing history.
* Your AI prompts or model responses.
* Any data from your computer outside of the extension's specific storage.
* Usage analytics or tracking information of any kind.

### Data Sharing and Third Parties

The Ollama Web Extension does not share your data with any third parties, with two clear exceptions that are under your control:

1. **Your Local Ollama Instance:** The extension's entire purpose is to send data to the Ollama server address **you provide**. You are in full control of this server.
2. **Your Browser Vendor:** As mentioned above, the `storage.sync` API is managed by your browser's manufacturer (e.g., Google, Mozilla), who may sync your extension settings across your devices.

We do not sell, rent, or otherwise disclose your information to advertisers, data brokers, or any other external entity.

### Security

We rely on the built-in security features of the web browser to protect the settings data stored on your machine. All communication between the extension and your Ollama instance happens locally on your network.

### Changes to This Privacy Policy

We may update this privacy policy from time to time. Any changes will be posted on this page, and we encourage you to review it periodically.

### Contact Us

If you have any questions or concerns about this privacy policy, please open an issue on our [GitHub repository](https://github.com/ashu01304/Ollama_Web).
