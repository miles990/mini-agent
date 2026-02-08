#!/bin/bash
# Chrome CDP 狀態感知
# stdout 會被包在 <chrome>...</chrome> 中注入 Agent context

CDP_PORT="${CDP_PORT:-9222}"
CDP_BASE="http://localhost:$CDP_PORT"

# Check if Chrome CDP is available
if curl -s --max-time 2 "$CDP_BASE/json/version" > /dev/null 2>&1; then
  VERSION=$(curl -s --max-time 2 "$CDP_BASE/json/version" 2>/dev/null)
  BROWSER=$(echo "$VERSION" | python3 -c "import sys,json; print(json.load(sys.stdin).get('Browser','Unknown'))" 2>/dev/null)

  TABS=$(curl -s --max-time 2 "$CDP_BASE/json" 2>/dev/null)
  TAB_COUNT=$(echo "$TABS" | python3 -c "import sys,json; print(len([t for t in json.load(sys.stdin) if t.get('type')=='page']))" 2>/dev/null)

  echo "Status: AVAILABLE"
  echo "Browser: $BROWSER"
  echo "Port: $CDP_PORT"
  echo "Open tabs: $TAB_COUNT"
  echo ""
  echo "Capabilities: fetch, open, extract, close"
  echo "Tool: node scripts/cdp-fetch.mjs <command> [args]"

  # List recent tabs (top 5)
  echo ""
  echo "Recent tabs:"
  echo "$TABS" | python3 -c "
import sys, json
tabs = [t for t in json.load(sys.stdin) if t.get('type') == 'page']
for t in tabs[:5]:
    title = (t.get('title','') or 'Untitled')[:50]
    url = (t.get('url',''))[:70]
    print(f'  [{t[\"id\"][:8]}] {title}')
    print(f'           {url}')
" 2>/dev/null

else
  echo "Status: NOT AVAILABLE"
  echo ""
  echo "Chrome is not running with CDP enabled."
  echo "To enable browser access, run:"
  echo "  mini-agent chrome-setup"
  echo ""
  echo "Or manually start Chrome with:"
  echo "  open -a 'Google Chrome' --args --remote-debugging-port=9222"
fi
