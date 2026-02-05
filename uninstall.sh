#!/bin/bash
# Mini-Agent Uninstaller

set -e

INSTALL_DIR="$HOME/.mini-agent"

echo "Uninstalling mini-agent..."

# Unlink
if command -v mini-agent >/dev/null 2>&1; then
  npm unlink -g mini-agent 2>/dev/null || true
fi

# Remove directory
if [ -d "$INSTALL_DIR" ]; then
  rm -rf "$INSTALL_DIR"
fi

echo "✓ mini-agent uninstalled!"
