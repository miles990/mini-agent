#!/bin/bash
# Chrome CDP 瀏覽器狀態感知
# stdout 會被包在 <chrome>...</chrome> 中注入 Agent context

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CDP_FETCH="$PROJECT_DIR/scripts/cdp-fetch.mjs"

# Check if cdp-fetch.mjs exists
if [[ ! -f "$CDP_FETCH" ]]; then
  echo "Status: NOT AVAILABLE"
  echo "cdp-fetch.mjs: not found"
  exit 0
fi

# Check Chrome CDP status
STATUS_OUTPUT=$(node "$CDP_FETCH" status 2>/dev/null)
if [ $? -eq 0 ] && [ -n "$STATUS_OUTPUT" ]; then
  echo "Status: AVAILABLE"
  echo "Bridge: Chrome CDP (port ${CDP_PORT:-9222})"
  echo ""
  echo "Capabilities: fetch, screenshot, open, extract, close, login, eval, click, type, scroll"
  echo "Tool: node scripts/cdp-fetch.mjs <command> [args]"
  echo ""
  echo "$STATUS_OUTPUT"
else
  echo "Status: NOT AVAILABLE"
  echo ""
  echo "Chrome CDP: not responding on port ${CDP_PORT:-9222}"
  echo ""
  echo "Start Chrome with: node scripts/cdp-fetch.mjs fetch about:blank"
fi
