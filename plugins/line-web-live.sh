#!/bin/bash
# LINE Web Live Perception — Chrome CDP + LINE Chrome Extension
# Reads LINE group chat messages in near-real-time via CDP
#
# Prerequisites:
#   1. LINE Chrome Extension installed (ophjlpahpchlmihnnnihgmmeilfjmjjc)
#   2. Logged in with LINE account
#   3. Group chat window open in the extension
#
# stdout → <line-group-live>...</line-group-live> in Agent context

set -euo pipefail

CDP_HOST="${CDP_HOST:-localhost}"
CDP_PORT="${CDP_PORT:-9222}"
LINE_EXT_ID="ophjlpahpchlmihnnnihgmmeilfjmjjc"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CDP_FETCH="$SCRIPT_DIR/scripts/cdp-fetch.mjs"
CACHE_DIR="$HOME/.mini-agent"
CACHE_FILE="$CACHE_DIR/line-live-cache.txt"
MSG_LOG="$CACHE_DIR/line-messages.jsonl"
CACHE_TTL=55  # just under 60s interval

# Return cache if fresh
if [[ -f "$CACHE_FILE" ]]; then
  CACHE_AGE=$(( $(date +%s) - $(stat -f %m "$CACHE_FILE" 2>/dev/null || echo 0) ))
  if [[ $CACHE_AGE -lt $CACHE_TTL ]]; then
    cat "$CACHE_FILE"
    exit 0
  fi
fi

# Check CDP
if ! curl -sf "http://${CDP_HOST}:${CDP_PORT}/json/version" >/dev/null 2>&1; then
  echo "CDP not available"
  exit 0
fi

# Find LINE extension targets
TARGETS=$(curl -sf "http://${CDP_HOST}:${CDP_PORT}/json/list" 2>/dev/null || echo "[]")
LINE_TAB=$(echo "$TARGETS" | jq -r "[.[] | select(.url | startswith(\"chrome-extension://${LINE_EXT_ID}/\"))] | .[0].id // empty")

if [[ -z "$LINE_TAB" ]]; then
  echo "LINE Extension: not open"
  echo "Install: https://chromewebstore.google.com/detail/line/${LINE_EXT_ID}"
  echo "Then: login + open group chat"
  exit 0
fi

LINE_TITLE=$(echo "$TARGETS" | jq -r "[.[] | select(.url | startswith(\"chrome-extension://${LINE_EXT_ID}/\"))] | .[0].title // \"LINE\"")

# Extract content from LINE extension tab
CONTENT=$(timeout 10 node "$CDP_FETCH" extract "$LINE_TAB" 2>/dev/null || echo "")

if [[ -z "$CONTENT" || ${#CONTENT} -lt 30 ]]; then
  echo "LINE Extension: open but couldn't read (tab: $LINE_TAB)"
  exit 0
fi

# Save raw to message log (ring buffer for mushi)
mkdir -p "$CACHE_DIR"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '{"ts":"%s","content":%s}\n' "$TS" "$(echo "$CONTENT" | jq -Rs .)" >> "$MSG_LOG"

# Trim log to 300 entries
if [[ -f "$MSG_LOG" ]]; then
  LC=$(wc -l < "$MSG_LOG" | tr -d ' ')
  if [[ $LC -gt 500 ]]; then
    tail -300 "$MSG_LOG" > "${MSG_LOG}.tmp" && mv "${MSG_LOG}.tmp" "$MSG_LOG"
  fi
fi

# Parse content — extract message lines (heuristic, refined after DOM inspection)
PARSED=$(python3 -c "
import sys
raw = sys.stdin.read()
# Find content section
start = raw.find('--- Content ---')
if start >= 0:
    raw = raw[start + 15:]
# Clean up: skip empty lines, UI chrome
lines = raw.strip().split('\n')
result = []
for line in lines:
    s = line.strip()
    if s and len(s) > 1:
        result.append(s)
output = '\n'.join(result)
print(output[:1800])
" <<< "$CONTENT" 2>/dev/null || echo "$CONTENT" | head -60)

# Format output
OUTPUT="=== LINE Live (${LINE_TITLE}) ===
Updated: $(date '+%H:%M:%S')
Tab: ${LINE_TAB}

${PARSED}"

# Cap at 2000 chars
OUTPUT="${OUTPUT:0:2000}"

echo "$OUTPUT" > "$CACHE_FILE"
echo "$OUTPUT"
