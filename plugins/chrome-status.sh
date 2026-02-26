#!/bin/bash
# Chrome CDP 瀏覽器狀態感知（compact output）
# stdout 會被包在 <chrome>...</chrome> 中注入 Agent context

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CDP_FETCH="$PROJECT_DIR/scripts/cdp-fetch.mjs"

# Check if cdp-fetch.mjs exists
if [[ ! -f "$CDP_FETCH" ]]; then
  echo "CDP: N/A"
  exit 0
fi

# Check Chrome CDP status
STATUS_OUTPUT=$(node "$CDP_FETCH" status 2>/dev/null)
if [ $? -eq 0 ] && [ -n "$STATUS_OUTPUT" ]; then
  echo "CDP: OK (port ${CDP_PORT:-9222})"
  # Only output tab list (the useful dynamic info)
  echo "$STATUS_OUTPUT" | grep -E '^\s+\[' | head -5
else
  echo "CDP: offline"
fi
