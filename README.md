
# Ollama Universal Web Extension

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)
![Built for](https://img.shields.io/badge/Built_for-Chrome_&_Firefox-green.svg)

A secure, cross-browser web extension acting as a local proxy to your [Ollama](https://ollama.com/) instance, enabling web applications to communicate with local language models without exposing the Ollama API to the internet.

Built with a modern Webpack system and a unified manifest for generating compatible packages for **Chrome** (Manifest V3) and **Firefox** (Manifest V2).

![Extension Popup Screenshot](images/ss01.png)

## ✨ Features

* **Cross-Browser Support** : Single codebase for Chrome and Firefox.
* **Configurable Ollama Endpoint** : Update the Ollama instance URL via the popup UI.
* **Interactive Popup** : View available models, send test prompts, and verify connections.
* **Secure Web App Integration** : Domain-based allow-list for authorized web app communication.
* **Developer-Friendly Proxy** : Forwards requests to Ollama API endpoints (`/api/generate`, `/api/chat`, `/api/tags`).

## 📦 Installation from Source

1. **Clone the repository:**

   ```bash
   git clone https://github.com/ashu01304/Ollama_Web.git
   cd Ollama_Web/ollama-webpack-extension
   ```
2. **Install dependencies:**

   ```bash
   yarn install
   ```
3. **Build the extension:**

   * **Chrome:**

   ```bash
   yarn build:chrome
   ```

   * **Firefox:**

   ```bash
   yarn build:firefox
   ```

   Output: `dist/chrome` or `dist/firefox`.
4. **Load the extension:**

   * **Chrome** :

   1. Go to `chrome://extensions`.
   2. Enable "Developer mode".
   3. Click "Load unpacked" and select `dist/chrome`.

   * **Firefox** :

   1. Go to `about:debugging#/runtime/this-firefox`.
   2. Click "Load Temporary Add-on...".
   3. Select any file in `dist/firefox` (e.g., `manifest.json`).

## 🚀 Usage

### Popup UI

Click the extension icon to:

* Update the Ollama API endpoint.
* View downloaded models.
* Test prompts.
* Manage allowed websites.

### Web App Developers

#### 1. Authorize Your Web App

Add your web app's origin to the allow-list:

1. Open the extension popup.
2. Go to "Allowed Domains".
3. Add your origin (e.g., `http://localhost:3000/*` or `https://my-awesome-app.com/*`).

#### 2. Communicate from Your Web App

Use this example to fetch models:

```javascript
const CHROME_EXTENSION_ID = "YOUR_CHROME_EXTENSION_ID_HERE";

async function sendMessageToOllamaExtension(payload) {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(CHROME_EXTENSION_ID, payload, (response) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: `Extension error: ${chrome.runtime.lastError.message}` });
        } else {
          resolve(response);
        }
      });
    });
  }

  return new Promise((resolve) => {
    const listener = (event) => {
      if (event.source === window && event.data?.direction === "extension-to-formstr") {
        window.removeEventListener("message", listener);
        resolve(event.data.message);
      }
    };
    window.addEventListener("message", listener);
    window.postMessage({ direction: "formstr-to-extension", message: payload }, "*");
  });
}

async function getModels() {
  const response = await sendMessageToOllamaExtension({
    type: "ollamaRequest",
    endpoint: "/api/tags",
    options: { method: 'GET' },
  });

  if (response.success) {
    console.log("Available models:", response.data.models);
  } else {
    console.error("Error:", response.error);
  }
}

getModels();
```

 **Note for Chrome** : Replace `YOUR_CHROME_EXTENSION_ID_HERE` with your extension's ID from `chrome://extensions`. Firefox requires no ID.

## 🛠️ Development

1. Install dependencies:
   ```bash
   yarn install
   ```
2. Build for your browser:
   ```bash
   yarn build:chrome
   yarn build:firefox
   ```

## 🛠 Technology Stack

* **TypeScript** : For robust code.
* **Webpack** : Professional extension bundler.
* **React** : Popup UI.
* **webextension-polyfill** : Cross-browser extension APIs.

## 📄 License

MIT License.
