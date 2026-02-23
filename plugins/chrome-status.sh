#!/bin/bash
# Pinchtab 瀏覽器狀態感知
# stdout 會被包在 <chrome>...</chrome> 中注入 Agent context

PINCHTAB_PORT="${PINCHTAB_PORT:-9867}"
PINCHTAB_BASE="http://localhost:$PINCHTAB_PORT"

# Check if Pinchtab is available
HEALTH=$(curl -s --max-time 2 "$PINCHTAB_BASE/health" 2>/dev/null)
if [ -n "$HEALTH" ]; then
  TABS=$(curl -s --max-time 2 "$PINCHTAB_BASE/tabs" 2>/dev/null)
  TAB_COUNT=$(echo "$TABS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "?")

  echo "Status: AVAILABLE"
  echo "Bridge: Pinchtab"
  echo "Port: $PINCHTAB_PORT"
  echo "Open tabs: $TAB_COUNT"
  echo ""
  echo "Capabilities: fetch, open, extract, close, screenshot, a11y-snapshot"
  echo "Tool: bash scripts/pinchtab-fetch.sh <command> [args]"

  # List recent tabs (top 5)
  echo ""
  echo "Recent tabs:"
  echo "$TABS" | python3 -c "
import sys, json
try:
    tabs = json.load(sys.stdin)
    for t in tabs[:5]:
        title = (t.get('title','') or 'Untitled')[:50]
        url = (t.get('url',''))[:70]
        tid = str(t.get('id', t.get('tabId', '')))[:8]
        print(f'  [{tid}] {title}')
        print(f'           {url}')
except:
    pass
" 2>/dev/null

else
  echo "Status: NOT AVAILABLE"
  echo ""

  # Detect Pinchtab state
  if [ -f "$HOME/.mini-agent/bin/pinchtab" ]; then
    echo "Pinchtab: installed but not running"
  else
    echo "Pinchtab: not installed"
  fi

  # Check port conflict
  PORT_PID=$(lsof -ti :"$PINCHTAB_PORT" 2>/dev/null | head -1)
  if [[ -n "$PORT_PID" ]]; then
    PORT_PROC=$(ps -p "$PORT_PID" -o comm= 2>/dev/null)
    echo "Port $PINCHTAB_PORT: in use by $PORT_PROC (PID: $PORT_PID)"
  else
    echo "Port $PINCHTAB_PORT: free"
  fi

  echo ""
  echo "Auto-fix: bash scripts/pinchtab-setup.sh start"
fi
