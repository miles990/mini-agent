#!/bin/bash
# Pinchtab Fetch — Browser content fetcher via Pinchtab API
#
# Drop-in replacement for cdp-fetch.mjs with identical CLI interface.
# Writes operations to ~/.mini-agent/cdp.jsonl (workspace.ts compatible).
#
# Usage:
#   bash scripts/pinchtab-fetch.sh status                  # Check availability
#   bash scripts/pinchtab-fetch.sh fetch <url>             # Fetch page content (truncated)
#   bash scripts/pinchtab-fetch.sh fetch <url> --full      # Fetch full content
#   bash scripts/pinchtab-fetch.sh open <url>              # Open visible tab
#   bash scripts/pinchtab-fetch.sh extract [tabId]         # Extract from tab (truncated)
#   bash scripts/pinchtab-fetch.sh extract [tabId] --full  # Extract full content
#   bash scripts/pinchtab-fetch.sh close <tabId>           # Close a tab

PINCHTAB_PORT="${PINCHTAB_PORT:-9867}"
PINCHTAB_BASE="http://localhost:${PINCHTAB_PORT}"
PINCHTAB_TIMEOUT="${PINCHTAB_TIMEOUT:-15000}"
PINCHTAB_MAX_CONTENT="${PINCHTAB_MAX_CONTENT:-8000}"
LOG_DIR="$HOME/.mini-agent"
LOG_FILE="$LOG_DIR/cdp.jsonl"

# ─── Helpers ──────────────────────────────────────────────────────────────────

log_op() {
  local op="$1"; shift
  mkdir -p "$LOG_DIR"
  local entry
  entry=$(python3 -c "
import json, datetime
d = {'ts': datetime.datetime.utcnow().isoformat() + 'Z', 'op': '$op'}
extra = dict(zip(['url','tabId','title'], '''$@'''.split('|')))
d.update({k:v for k,v in extra.items() if v})
print(json.dumps(d))
" 2>/dev/null || echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"op\":\"$op\"}")
  echo "$entry" >> "$LOG_FILE" 2>/dev/null
}

timeout_secs() {
  echo $(( PINCHTAB_TIMEOUT / 1000 ))
}

health_ok() {
  curl -sf --max-time 3 "${PINCHTAB_BASE}/health" >/dev/null 2>&1
}

# ─── Commands ─────────────────────────────────────────────────────────────────

cmd_status() {
  if ! health_ok; then
    echo "Pinchtab: NOT AVAILABLE"
    echo ""
    echo "To enable, run:"
    echo "  bash scripts/pinchtab-setup.sh start"
    exit 1
  fi

  echo "Pinchtab: AVAILABLE (${PINCHTAB_BASE})"

  # List tabs
  local tabs
  tabs=$(curl -sf --max-time 5 "${PINCHTAB_BASE}/tabs" 2>/dev/null)
  if [[ -n "$tabs" ]]; then
    local tab_info
    tab_info=$(echo "$tabs" | python3 -c "
import sys, json
try:
    tabs = json.load(sys.stdin)
    print(f'Open tabs: {len(tabs)}')
    print()
    for t in tabs[:10]:
        title = (t.get('title', '') or 'Untitled')[:60]
        url = (t.get('url', '') or '')[:80]
        tid = t.get('id', t.get('tabId', ''))
        print(f'  [{str(tid)[:8]}] {title}')
        print(f'           {url}')
    if len(tabs) > 10:
        print(f'  ... and {len(tabs) - 10} more')
except Exception as e:
    print(f'Tab parse error: {e}')
" 2>/dev/null)
    echo "$tab_info"
  fi
}

cmd_fetch() {
  local url="$1"
  if [[ -z "$url" ]]; then
    echo "Usage: pinchtab-fetch.sh fetch <url>" >&2
    exit 1
  fi

  if ! health_ok; then
    echo "Pinchtab not available. Run: bash scripts/pinchtab-setup.sh start" >&2
    exit 1
  fi

  log_op "fetch" "$url"

  # Navigate to URL
  curl -sf --max-time "$(timeout_secs)" -X POST "${PINCHTAB_BASE}/navigate" \
    -H "Content-Type: application/json" \
    -d "{\"url\":\"$url\"}" >/dev/null 2>&1

  # Wait for page load
  sleep 2

  # Get text content
  local content
  content=$(curl -sf --max-time "$(timeout_secs)" "${PINCHTAB_BASE}/text" 2>/dev/null)

  if [[ -z "$content" ]]; then
    echo "Failed to fetch content from: $url" >&2
    exit 1
  fi

  # Check for auth page
  local is_auth
  is_auth=$(echo "$content" | head -20 | grep -ciE 'sign.in|log.in|login|password|captcha|verify|驗證|登入|403|forbidden|unauthorized' || true)

  if [[ "$is_auth" -ge 2 ]]; then
    echo "AUTH_REQUIRED: $url"
    echo ""
    echo "This page requires login/verification."
    echo "Use: bash scripts/pinchtab-fetch.sh open \"$url\" to open it visibly."
    return
  fi

  # Output content (with offset + truncation support)
  local total=${#content}
  if [[ $OFFSET -gt 0 ]]; then
    content="${content:$OFFSET}"
    total=${#content}
  fi
  if [[ "$FULL_OUTPUT" == "true" ]] || [[ $total -le $PINCHTAB_MAX_CONTENT ]]; then
    echo "$content"
  else
    echo "$content" | head -c "$PINCHTAB_MAX_CONTENT"
    local remaining=$((total - PINCHTAB_MAX_CONTENT))
    local next_offset=$((OFFSET + PINCHTAB_MAX_CONTENT))
    echo ""
    echo "[... truncated, ${remaining} more chars. Use --offset ${next_offset} to continue]"
  fi
}

cmd_open() {
  local url="$1"
  if [[ -z "$url" ]]; then
    echo "Usage: pinchtab-fetch.sh open <url>" >&2
    exit 1
  fi

  if ! health_ok; then
    echo "Pinchtab not available. Run: bash scripts/pinchtab-setup.sh start" >&2
    exit 1
  fi

  log_op "open" "$url"

  # Open new tab
  local result
  result=$(curl -sf --max-time "$(timeout_secs)" -X POST "${PINCHTAB_BASE}/tab" \
    -H "Content-Type: application/json" \
    -d "{\"action\":\"open\",\"url\":\"$url\"}" 2>/dev/null)

  local tab_id
  tab_id=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('tabId','unknown'))" 2>/dev/null || echo "unknown")

  echo "Opened: $url"
  echo "Tab ID: $tab_id"
  echo ""
  echo "Page is now visible in Chrome."
  echo "After logging in, use:"
  echo "  bash scripts/pinchtab-fetch.sh extract $tab_id"
}

cmd_extract() {
  local tab_id="$1"

  if ! health_ok; then
    echo "Pinchtab not available" >&2
    exit 1
  fi

  log_op "extract" "|$tab_id"

  # Get text content from current/specified tab
  local content
  if [[ -n "$tab_id" ]]; then
    # Switch to tab first
    curl -sf --max-time 5 -X POST "${PINCHTAB_BASE}/tab" \
      -H "Content-Type: application/json" \
      -d "{\"action\":\"activate\",\"tabId\":\"$tab_id\"}" >/dev/null 2>&1
    sleep 1
  fi

  content=$(curl -sf --max-time "$(timeout_secs)" "${PINCHTAB_BASE}/text" 2>/dev/null)

  if [[ -z "$content" ]]; then
    echo "Failed to extract content" >&2
    exit 1
  fi

  local total=${#content}
  if [[ $OFFSET -gt 0 ]]; then
    content="${content:$OFFSET}"
    total=${#content}
  fi
  if [[ "$FULL_OUTPUT" == "true" ]] || [[ $total -le $PINCHTAB_MAX_CONTENT ]]; then
    echo "$content"
  else
    echo "$content" | head -c "$PINCHTAB_MAX_CONTENT"
    local remaining=$((total - PINCHTAB_MAX_CONTENT))
    local next_offset=$((OFFSET + PINCHTAB_MAX_CONTENT))
    echo ""
    echo "[... truncated, ${remaining} more chars. Use --offset ${next_offset} to continue]"
  fi
}

cmd_close() {
  local tab_id="$1"
  if [[ -z "$tab_id" ]]; then
    echo "Usage: pinchtab-fetch.sh close <tabId>" >&2
    exit 1
  fi

  log_op "close" "|$tab_id"

  curl -sf --max-time 5 -X POST "${PINCHTAB_BASE}/tab" \
    -H "Content-Type: application/json" \
    -d "{\"action\":\"close\",\"tabId\":\"$tab_id\"}" >/dev/null 2>&1

  echo "Closed tab: $tab_id"
}

# ─── Main ─────────────────────────────────────────────────────────────────────

# Parse flags from any position
FULL_OUTPUT=false
OFFSET=0
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --full) FULL_OUTPUT=true ;;
    --offset) OFFSET="${2:-0}"; shift ;;
    *) ARGS+=("$1") ;;
  esac
  shift
done

case "${ARGS[0]:-}" in
  status)   cmd_status ;;
  fetch)    cmd_fetch "${ARGS[1]:-}" ;;
  open)     cmd_open "${ARGS[1]:-}" ;;
  extract)  cmd_extract "${ARGS[1]:-}" ;;
  close)    cmd_close "${ARGS[1]:-}" ;;
  *)
    echo "pinchtab-fetch — Browser content fetcher via Pinchtab"
    echo ""
    echo "Commands:"
    echo "  status              Check Pinchtab availability"
    echo "  fetch <url>              Fetch page content (first 8000 chars)"
    echo "  fetch <url> --full       Fetch full content (no truncation)"
    echo "  fetch <url> --offset N   Skip first N chars (continue reading)"
    echo "  open <url>               Open visible tab (for login)"
    echo "  extract [tabId]          Extract content from tab"
    echo "  close <tabId>            Close a tab"
    echo ""
    echo "Flags (any command):"
    echo "  --full                   No truncation"
    echo "  --offset N               Skip first N chars"
    echo ""
    echo "Environment:"
    echo "  PINCHTAB_PORT=9867          API port"
    echo "  PINCHTAB_TIMEOUT=15000      Command timeout (ms)"
    echo "  PINCHTAB_MAX_CONTENT=8000   Max content chars"
    ;;
esac
