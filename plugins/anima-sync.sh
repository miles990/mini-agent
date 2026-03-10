#!/bin/bash
# Anima Sync Plugin — 感知 anima 知識同步站的新知識
#
# anima (localhost:3002) 的 Kuro 角色透過對話和 web search 累積知識
# 此 plugin 從 sync-outbox 讀取新的 belief/reflection/observation
# 輸出到 <anima-sync> section，Kuro 在 OODA cycle 中 review + 吸收

ANIMA_HOST="${ANIMA_HOST:-http://localhost:3002}"
LAST_SYNC_FILE="$HOME/.mini-agent/anima-last-sync"

# Check if anima is running
if ! curl -sf --max-time 3 "$ANIMA_HOST/health" >/dev/null 2>&1; then
  echo "anima offline"
  exit 0
fi

# Read last sync timestamp
SINCE=""
if [ -f "$LAST_SYNC_FILE" ]; then
  SINCE=$(cat "$LAST_SYNC_FILE" 2>/dev/null)
fi

# Fetch new entries from outbox
if [ -n "$SINCE" ]; then
  RESPONSE=$(curl -sf --max-time 10 "$ANIMA_HOST/api/sync/outbox?since=$SINCE" 2>/dev/null)
else
  RESPONSE=$(curl -sf --max-time 10 "$ANIMA_HOST/api/sync/outbox" 2>/dev/null)
fi

if [ -z "$RESPONSE" ]; then
  echo "anima online, no sync data yet"
  exit 0
fi

# Parse entry count
COUNT=$(echo "$RESPONSE" | jq -r '.entries | length' 2>/dev/null)
if [ "$COUNT" = "null" ] || [ "$COUNT" = "0" ] || [ -z "$COUNT" ]; then
  echo "anima online, no new knowledge"
  exit 0
fi

# Update last sync timestamp
LATEST_TS=$(echo "$RESPONSE" | jq -r '.entries[-1].timestamp // empty' 2>/dev/null)
if [ -n "$LATEST_TS" ]; then
  echo "$LATEST_TS" > "$LAST_SYNC_FILE"
fi

# Output entries for context
echo "=== $COUNT new entries from anima Kuro ==="
echo ""
echo "$RESPONSE" | jq -r '.entries[] | "[\(.type)] \(.content)\(if .source.conversationId then " (conv: " + .source.conversationId + ")" else "" end)"' 2>/dev/null
