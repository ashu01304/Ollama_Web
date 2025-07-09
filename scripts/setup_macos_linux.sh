#!/bin/bash

# This script helps configure the OLLAMA_ORIGINS environment variable for the Ollama Web Extension.

echo "This script will help you configure Ollama to accept connections from the browser extension."
echo "You may be asked for your password to grant admin privileges for some commands."
echo

# Detect OS
OS_TYPE=$(uname)

# --- Function to set environment variable in shell profile ---
set_shell_profile() {
    local var_name="$1"
    local var_value="$2"
    local profile_file=""
    
    if [ -n "$ZSH_VERSION" ]; then profile_file="$HOME/.zshrc"; elif [ -n "$BASH_VERSION" ]; then profile_file="$HOME/.bashrc"; if [ "$OS_TYPE" == "Darwin" ] && [ -f "$HOME/.bash_profile" ]; then profile_file="$HOME/.bash_profile"; fi; else profile_file="$HOME/.profile"; fi

    echo "Attempting to add configuration to your shell profile: $profile_file"
    if grep -q "export $var_name=" "$profile_file"; then
        echo "$var_name is already set. Please verify it includes the necessary origins."
    else
        echo "" >> "$profile_file"
        echo "# Added by Ollama Web Extension setup script" >> "$profile_file"
        echo "export $var_name=\"$var_value\"" >> "$profile_file"
        echo "✅ Configuration has been added to $profile_file."
        echo "Please restart your terminal or run 'source $profile_file' and then restart the Ollama server."
    fi
}

# --- Main Logic ---
OLLAMA_ORIGINS_VALUE="chrome-extension://*,moz-extension://*"
echo "The required value for OLLAMA_ORIGINS is: $OLLAMA_ORIGINS_VALUE"
echo

if [ "$OS_TYPE" == "Linux" ] && command -v systemctl &> /dev/null && systemctl list-units --type=service | grep -q "ollama.service"; then
    echo "Detected Linux with Ollama systemd service. Configuring service..."
    SERVICE_FILE="/etc/systemd/system/ollama.service.d/override.conf"
    sudo mkdir -p /etc/systemd/system/ollama.service.d
    sudo tee "$SERVICE_FILE" > /dev/null <<EOF
[Service]
Environment="OLLAMA_ORIGINS=$OLLAMA_ORIGINS_VALUE"
EOF
    sudo systemctl daemon-reload && sudo systemctl restart ollama
    echo "✅ Ollama systemd service configured and restarted successfully."

elif [ "$OS_TYPE" == "Darwin" ] && [ -f "$HOME/Library/LaunchAgents/com.ollama.ollama.plist" ]; then
    echo "Detected macOS with Ollama launch agent. Configuring agent..."
    PLIST_FILE="$HOME/Library/LaunchAgents/com.ollama.ollama.plist"
    plutil -insert EnvironmentVariables.OLLAMA_ORIGINS -string "$OLLAMA_ORIGINS_VALUE" "$PLIST_FILE"
    launchctl unload "$PLIST_FILE" && launchctl load "$PLIST_FILE"
    echo "✅ Ollama launch agent configured and restarted successfully."

else
    echo "Could not detect an Ollama service/agent. Falling back to shell profile configuration."
    set_shell_profile "OLLAMA_ORIGINS" "$OLLAMA_ORIGINS_VALUE"
fi

echo
echo "Setup complete."