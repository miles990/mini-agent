#!/bin/bash
# Mini-Agent Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/miles990/mini-agent/main/install.sh | bash

set -e

REPO="https://github.com/miles990/mini-agent.git"
INSTALL_DIR="$HOME/.mini-agent"
MIN_NODE_VERSION=20

# Colors (disable if not terminal)
if [ -t 1 ]; then
  GREEN='\033[0;32m'; RED='\033[0;31m'; DIM='\033[2m'; RESET='\033[0m'
else
  GREEN=''; RED=''; DIM=''; RESET=''
fi

step() { echo -e "\n${GREEN}[$1/4]${RESET} $2"; }
fail() { echo -e "${RED}Error:${RESET} $1"; exit 1; }

echo "mini-agent installer"
echo "===================="

# --- Step 1: Check dependencies ---
step 1 "Checking dependencies..."

# Git
command -v git >/dev/null 2>&1 || fail "git is required"

# Node.js 20+
command -v node >/dev/null 2>&1 || fail "Node.js $MIN_NODE_VERSION+ is required — https://nodejs.org"
NODE_VERSION=$(node -e "console.log(process.versions.node.split('.')[0])")
[ "$NODE_VERSION" -ge "$MIN_NODE_VERSION" ] 2>/dev/null || fail "Node.js $MIN_NODE_VERSION+ required (found v$NODE_VERSION)"

# pnpm — auto-enable via corepack (built into Node 20+)
if ! command -v pnpm >/dev/null 2>&1; then
  echo -e "  ${DIM}pnpm not found, enabling via corepack...${RESET}"
  corepack enable 2>/dev/null || npm install -g pnpm
fi
command -v pnpm >/dev/null 2>&1 || fail "Could not install pnpm"

# Claude CLI
if ! command -v claude >/dev/null 2>&1; then
  echo ""
  echo -e "  ${RED}Claude CLI not found.${RESET}"
  echo "  Install it first:"
  echo ""
  echo "    npm install -g @anthropic-ai/claude-code"
  echo ""
  echo "  Then run this installer again."
  exit 1
fi

echo -e "  node v$NODE_VERSION ${DIM}✓${RESET}"
echo -e "  pnpm $(pnpm --version 2>/dev/null) ${DIM}✓${RESET}"
echo -e "  claude CLI ${DIM}✓${RESET}"

# --- Step 2: Clone or update ---
step 2 "Getting source code..."

if [ -d "$INSTALL_DIR/.git" ]; then
  echo -e "  ${DIM}Updating existing installation...${RESET}"
  cd "$INSTALL_DIR" && git pull --ff-only
else
  if [ -d "$INSTALL_DIR" ]; then
    fail "$INSTALL_DIR exists but is not a git repo. Remove it first."
  fi
  git clone "$REPO" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# --- Step 3: Build ---
step 3 "Installing dependencies and building..."

pnpm install --frozen-lockfile 2>/dev/null || pnpm install
pnpm build

# --- Step 4: Link globally ---
step 4 "Linking mini-agent command..."

npm link 2>/dev/null || {
  echo -e "  ${DIM}npm link failed, trying with sudo...${RESET}"
  sudo npm link
}

echo ""
echo "============================="
echo -e " ${GREEN}✓ mini-agent installed!${RESET}"
echo "============================="
echo ""
echo "  mini-agent              # Interactive chat"
echo "  mini-agent up -d        # Start in background"
echo "  mini-agent status       # Check status"
echo ""
echo -e "  ${DIM}Installed to: $INSTALL_DIR${RESET}"
echo ""
