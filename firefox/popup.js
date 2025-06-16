document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("sendButton").addEventListener("click", sendPrompt);
  document.getElementById("addDomainButton").addEventListener("click", addDomain);
  document.getElementById("addCurrentDomainButton").addEventListener("click", addCurrentDomain);
  document.getElementById("allowAllButton").addEventListener("click", allowAllDomains);
  document.getElementById("setEndpointButton").addEventListener("click", setEndpoint);

  fetchModels();
  loadDomains();
  loadEndpoint();
});

function fetchModels() {
  const modelSelect = document.getElementById("modelSelect");
  modelSelect.innerHTML = '<option value="">Loading models...</option>';
  browser.runtime.sendMessage({ type: "fetchModels" }).then(handleResponse).catch(handleError);

  function handleResponse(response) {
    if (response && response.success && response.data.models) {
      modelSelect.innerHTML = '<option value="">Select a model</option>';
      response.data.models.forEach(model => {
        const option = document.createElement("option");
        option.value = model.name;
        option.text = model.name;
        modelSelect.appendChild(option);
      });
    } else {
      modelSelect.innerHTML = '<option value="">No models found</option>';
      showError(response ? response.error : "Could not fetch models.");
    }
  }

  function handleError(error) {
    modelSelect.innerHTML = '<option value="">Error loading</option>';
    showError(error.message);
  }
}

function sendPrompt() {
  const prompt = document.getElementById("prompt").value;
  const model = document.getElementById("modelSelect").value;
  if (!prompt) {
    showError("Please enter a prompt.");
    return;
  }
  if (!model) {
    showError("Please select a model.");
    return;
  }

  showLoading(true);
  browser.runtime.sendMessage({ type: "sendToOllama", prompt, model }).then(response => {
    showLoading(false);
    if (response && response.success) {
      showResponse(response.data.response || "No text content in response.");
    } else {
      showError(response ? response.error : "An unknown error occurred.");
    }
  }).catch(error => {
    showLoading(false);
    showError(error.message);
  });
}

function loadDomains() {
  const domainList = document.getElementById("domainList");
  browser.runtime.sendMessage({ type: "getDomains" }).then(response => {
    domainList.innerHTML = "";
    if (response && response.domains && response.domains.length) {
      response.domains.forEach(domain => {
        const li = document.createElement("li");
        li.textContent = domain;
        const removeButton = document.createElement("button");
        removeButton.textContent = "Remove";
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
  if (domain) {
    browser.runtime.sendMessage({ type: "addDomain", domain }).then(response => {
      if (response && response.success) {
        domainInput.value = "";
        loadDomains();
      } else {
        showError(response ? response.error : "Error adding domain.");
      }
    });
  } else {
    showError("Please enter a domain.");
  }
}

function addCurrentDomain() {
  browser.runtime.sendMessage({ type: "addCurrentDomain" }).then(response => {
    if (response && response.success) {
      loadDomains();
    } else {
      showError(response ? response.error : "Error adding current domain.");
    }
  });
}

function allowAllDomains() {
  browser.runtime.sendMessage({ type: "allowAllDomains" }).then(response => {
    if (response && response.success) {
      loadDomains();
    } else {
      showError("Error allowing all domains.");
    }
  });
}

function removeDomain(domain) {
  browser.runtime.sendMessage({ type: "removeDomain", domain }).then(response => {
    if (response && response.success) {
      loadDomains();
    } else {
      showError("Error removing domain.");
    }
  });
}

function setEndpoint() {
  const endpointInput = document.getElementById("endpointInput");
  const endpoint = endpointInput.value.trim();
  if (endpoint) {
    browser.runtime.sendMessage({ type: "setEndpoint", endpoint }).then(response => {
      if (response && response.success) {
        endpointInput.value = "";
        loadEndpoint();
        fetchModels();
        showResponse("Endpoint updated successfully.");
      } else {
        showError(response ? response.error : "Error setting endpoint.");
      }
    });
  } else {
    showError("Please enter an endpoint URL.");
  }
}

function loadEndpoint() {
  const endpointInput = document.getElementById("endpointInput");
  browser.runtime.sendMessage({ type: "getEndpoint" }).then(response => {
    if (response && response.endpoint) {
      endpointInput.placeholder = `Current: ${response.endpoint}`;
    }
  });
}

function showLoading(isLoading) {
  document.getElementById("loading").style.display = isLoading ? "block" : "none";
  document.getElementById("sendButton").disabled = isLoading;
  if (isLoading) {
    document.getElementById("response").textContent = "";
  }
}

function showError(message) {
  const responseDiv = document.getElementById("response");
  responseDiv.style.color = "#dc3545";
  responseDiv.textContent = `Error: ${message}`;
}

function showResponse(text) {
  const responseDiv = document.getElementById("response");
  responseDiv.style.color = "initial";
  responseDiv.textContent = text;
}