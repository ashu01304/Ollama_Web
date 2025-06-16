document.getElementById("sendButton").addEventListener("click", sendPrompt);
document.getElementById("addDomainButton").addEventListener("click", addDomain);
document.getElementById("addCurrentDomainButton").addEventListener("click", addCurrentDomain);
document.getElementById("allowAllButton").addEventListener("click", allowAllDomains);
document.getElementById("setEndpointButton").addEventListener("click", setEndpoint);
window.addEventListener("load", () => {
  fetchModels();
  loadDomains();
  loadEndpoint();
});

function fetchModels() {
  const modelSelect = document.getElementById("modelSelect");
  chrome.runtime.sendMessage({ type: "fetchModels" }, (response) => {
    if (response.success && response.data.models) {
      modelSelect.innerHTML = '<option value="">Select a model</option>';
      response.data.models.forEach(model => {
        const option = document.createElement("option");
        option.value = model.name;
        option.text = model.name;
        modelSelect.appendChild(option);
      });
    } else {
      modelSelect.innerHTML = '<option value="">No models available</option>';
    }
  });
}

function sendPrompt() {
  const promptInput = document.getElementById("prompt");
  const modelSelect = document.getElementById("modelSelect");
  const prompt = promptInput.value;
  const model = modelSelect.value;
  const responseDiv = document.getElementById("response");
  const loadingDiv = document.getElementById("loading");

  if (!prompt) {
    responseDiv.innerText = "Please enter a prompt.";
    return;
  }
  if (!model) {
    responseDiv.innerText = "Please select a model.";
    return;
  }

  responseDiv.innerText = "";
  loadingDiv.style.display = "block";

  chrome.runtime.sendMessage(
    { type: "sendToOllama", prompt: prompt, model: model },
    (response) => {
      loadingDiv.style.display = "none";

      if (chrome.runtime.lastError) {
        responseDiv.innerText = `Error: ${chrome.runtime.lastError.message}. Please reload the extension.`;
        return;
      }

      if (!response) {
        responseDiv.innerText = "Error: Received no response from the background script.";
        return;
      }

      if (response.success) {
        responseDiv.innerText = response.data.response || "No response received.";
      } else {
        responseDiv.innerText = `Error: ${response.error}. Ensure Ollama is running and accessible.`;
      }
    }
  );
}

function loadDomains() {
  const domainList = document.getElementById("domainList");
  chrome.runtime.sendMessage({ type: "getDomains" }, (response) => {
    domainList.innerHTML = "";
    if (response.domains && response.domains.length) {
      response.domains.forEach(domain => {
        const li = document.createElement("li");
        li.innerText = domain;
        const removeButton = document.createElement("button");
        removeButton.innerText = "Remove";
        removeButton.onclick = () => removeDomain(domain);
        li.appendChild(removeButton);
        domainList.appendChild(li);
      });
    } else {
      domainList.innerHTML = "<li>No domains added.</li>";
    }
  });
}

function addDomain() {
  const domainInput = document.getElementById("domainInput");
  const domain = domainInput.value.trim();
  const responseDiv = document.getElementById("response");
  if (domain) {
    chrome.runtime.sendMessage({ type: "addDomain", domain: domain }, (response) => {
      if (response.success) {
        domainInput.value = "";
        loadDomains();
      } else {
        responseDiv.innerText = response.error || "Error adding domain.";
      }
    });
  } else {
    responseDiv.innerText = "Please enter a domain.";
  }
}

function addCurrentDomain() {
  const responseDiv = document.getElementById("response");
  chrome.runtime.sendMessage({ type: "addCurrentDomain" }, (response) => {
    if (response.success) {
      loadDomains();
    } else {
      responseDiv.innerText = response.error || "Error adding current domain.";
    }
  });
}

function allowAllDomains() {
  const responseDiv = document.getElementById("response");
  chrome.runtime.sendMessage({ type: "allowAllDomains" }, (response) => {
    if (response.success) {
      loadDomains();
    } else {
      responseDiv.innerText = "Error allowing all domains.";
    }
  });
}

function removeDomain(domain) {
  const responseDiv = document.getElementById("response");
  chrome.runtime.sendMessage({ type: "removeDomain", domain: domain }, (response) => {
    if (response.success) {
      loadDomains();
    } else {
      responseDiv.innerText = "Error removing domain.";
    }
  });
}

function setEndpoint() {
  const endpointInput = document.getElementById("endpointInput");
  const endpoint = endpointInput.value.trim();
  const responseDiv = document.getElementById("response");
  if (endpoint) {
    chrome.runtime.sendMessage({ type: "setEndpoint", endpoint: endpoint }, (response) => {
      if (response.success) {
        endpointInput.value = "";
        loadEndpoint();
        fetchModels();
      } else {
        responseDiv.innerText = response.error || "Error setting endpoint.";
      }
    });
  } else {
    responseDiv.innerText = "Please enter an endpoint.";
  }
}

function loadEndpoint() {
  const endpointInput = document.getElementById("endpointInput");
  chrome.runtime.sendMessage({ type: "getEndpoint" }, (response) => {
    if (response.endpoint) {
      endpointInput.placeholder = `Current: ${response.endpoint}`;
    }
  });
}