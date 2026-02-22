#!/bin/bash
# X/Twitter Feed Perception — CDP-based (Phase 1)
# stdout gets wrapped in <x-feed>...</x-feed> and injected into Agent context
# Heartbeat interval (30min)
#
# Strategy: Extract from already-open X tabs in Chrome using CDP eval.
# X is a React SPA — generic innerText extraction fails.
# Must use data-testid selectors to reach the real content.

CDP_PORT="${CDP_PORT:-9222}"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CDP_INTERACT="$SCRIPT_DIR/scripts/cdp-interact.mjs"
CACHE_DIR="$HOME/.mini-agent"
CACHE_FILE="$CACHE_DIR/x-feed-cache.txt"
CACHE_TTL=1500  # 25min

# macOS-compatible timeout
_timeout() {
  local secs="$1"; shift
  perl -e 'alarm shift; exec @ARGV' "$secs" "$@" 2>/dev/null
}

# Check CDP availability
if ! curl -s --max-time 2 "http://localhost:$CDP_PORT/json/version" > /dev/null 2>&1; then
  echo "CDP unavailable"
  exit 0
fi

# Return cache if fresh enough
if [[ -f "$CACHE_FILE" ]]; then
  CACHE_AGE=$(( $(date +%s) - $(stat -f %m "$CACHE_FILE" 2>/dev/null || echo 0) ))
  if [[ $CACHE_AGE -lt $CACHE_TTL ]]; then
    cat "$CACHE_FILE"
    exit 0
  fi
fi

# Find X tabs already open in Chrome
X_TABS=$(curl -s --max-time 2 "http://localhost:$CDP_PORT/json" 2>/dev/null \
  | python3 -c "
import sys, json
tabs = json.load(sys.stdin)
for t in tabs:
    url = t.get('url', '')
    tid = t.get('id', '')
    title = t.get('title', '')
    if 'x.com/home' in url:
        print(f'home|{tid}|{title}')
    elif 'x.com/Kuro938658' in url:
        print(f'profile|{tid}|{title}')
" 2>/dev/null)

if [[ -z "$X_TABS" ]]; then
  echo "No X tabs open in Chrome"
  exit 0
fi

OUTPUT=""

# Extract home timeline if available
HOME_TAB=$(echo "$X_TABS" | grep '^home|' | head -1)
if [[ -n "$HOME_TAB" ]]; then
  TAB_ID=$(echo "$HOME_TAB" | cut -d'|' -f2)

  # Use data-testid selector — X's React SPA hides content from generic extraction
  TIMELINE=$(_timeout 10 node "$CDP_INTERACT" eval "$TAB_ID" \
    "document.querySelector('[data-testid=\"primaryColumn\"]')?.innerText?.slice(0, 3000) || 'empty'" 2>/dev/null)

  if [[ -n "$TIMELINE" ]] && [[ "$TIMELINE" != "empty" ]]; then
    OUTPUT="Home Timeline ($(date +%H:%M)):"
    OUTPUT="$OUTPUT
$TIMELINE"
  fi
fi

# Extract profile/notifications if available
PROFILE_TAB=$(echo "$X_TABS" | grep '^profile|' | head -1)
if [[ -n "$PROFILE_TAB" ]]; then
  TAB_ID=$(echo "$PROFILE_TAB" | cut -d'|' -f2)

  PROFILE=$(_timeout 10 node "$CDP_INTERACT" eval "$TAB_ID" \
    "document.querySelector('[data-testid=\"primaryColumn\"]')?.innerText?.slice(0, 1500) || 'empty'" 2>/dev/null)

  if [[ -n "$PROFILE" ]] && [[ "$PROFILE" != "empty" ]]; then
    if [[ -n "$OUTPUT" ]]; then
      OUTPUT="$OUTPUT

---
"
    fi
    OUTPUT="${OUTPUT}Profile @Kuro938658:
$PROFILE"
  fi
fi

if [[ -z "$OUTPUT" ]]; then
  echo "X tabs found but content extraction failed"
  exit 0
fi

# Write cache and output
echo "$OUTPUT" | tee "$CACHE_FILE"
