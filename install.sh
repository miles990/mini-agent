#!/bin/bash
# Mini-Agent Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/user/mini-agent/main/install.sh | bash

set -e

REPO="https://github.com/miles990/mini-agent.git"
INSTALL_DIR="$HOME/.mini-agent"

echo "Installing mini-agent..."

# Check dependencies
command -v node >/dev/null 2>&1 || { echo "Error: Node.js is required"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "Error: pnpm is required (npm i -g pnpm)"; exit 1; }

# Clone or update
if [ -d "$INSTALL_DIR" ]; then
  echo "Updating existing installation..."
  cd "$INSTALL_DIR" && git pull
else
  echo "Cloning repository..."
  git clone "$REPO" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# Install and build
echo "Installing dependencies..."
pnpm install --silent

echo "Building..."
pnpm build

# Link globally
echo "Linking globally..."
npm link --silent

echo ""
echo "✓ mini-agent installed!"
echo ""
echo "Usage:"
echo "  mini-agent              # Interactive chat"
echo "  mini-agent server       # HTTP API"
echo "  echo '...' | mini-agent # Pipe mode"
