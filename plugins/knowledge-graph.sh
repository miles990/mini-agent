#!/bin/bash
# Knowledge Graph perception plugin — CE+R push + incremental sync
# Outputs: <knowledge-graph> section with contextually relevant knowledge + sync status

KG_URL="${KG_URL:-http://localhost:3300}"
STATE_DIR="${HOME}/.mini-agent"
CURSOR_FILE="${STATE_DIR}/kg-cursor.json"
PUSH_HASH_FILE="${STATE_DIR}/kg-push-hash"
INNER_NOTES="${PWD}/memory/inner-notes.md"
AGENT_ID="kuro"
PUSH_LIMIT=5
MAX_CONTEXT_CHARS=300

mkdir -p "$STATE_DIR"

if ! command -v jq &>/dev/null; then
  echo "KG: jq not installed"
  exit 0
fi

# Health check
if ! curl -sf --connect-timeout 2 --max-time 3 "${KG_URL}/health" >/dev/null 2>&1; then
  echo "KG offline"
  exit 0
fi

# ── CE+R Push: contextually relevant knowledge ──

# Build context from inner-notes (Kuro's working memory)
CONTEXT=""
if [ -f "$INNER_NOTES" ]; then
  CONTEXT=$(head -c "$MAX_CONTEXT_CHARS" "$INNER_NOTES" 2>/dev/null | tr '\n' ' ')
fi

# Fallback: if no inner-notes, use a generic context
if [ -z "$CONTEXT" ]; then
  CONTEXT="autonomous agent daily operations and learning"
fi

# Call push/formatted API
PUSH_RESULT=$(curl -sf --max-time 5 -X POST "${KG_URL}/api/push/formatted" \
  -H "Content-Type: application/json" \
  -d "{\"context\":$(echo "$CONTEXT" | jq -Rs .),\"agent_id\":\"${AGENT_ID}\",\"limit\":${PUSH_LIMIT}}" 2>/dev/null)

PUSH_COUNT=0
PUSH_TEXT=""
if [ -n "$PUSH_RESULT" ]; then
  PUSH_COUNT=$(echo "$PUSH_RESULT" | jq -r '.count // 0')
  PUSH_TEXT=$(echo "$PUSH_RESULT" | jq -r '.text // ""')
fi

# Hash-based dedup: skip if identical to last push
if [ "$PUSH_COUNT" -gt 0 ] && [ -n "$PUSH_TEXT" ]; then
  NEW_HASH=$(echo "$PUSH_TEXT" | md5 -q 2>/dev/null || echo "$PUSH_TEXT" | md5sum 2>/dev/null | cut -d' ' -f1)
  OLD_HASH=""
  [ -f "$PUSH_HASH_FILE" ] && OLD_HASH=$(cat "$PUSH_HASH_FILE" 2>/dev/null)

  if [ "$NEW_HASH" = "$OLD_HASH" ]; then
    PUSH_TEXT=""
    PUSH_COUNT=0
  else
    echo "$NEW_HASH" > "$PUSH_HASH_FILE"
  fi
fi

# ── Incremental sync: new knowledge events ──

CURSOR=0
if [ -f "$CURSOR_FILE" ]; then
  CURSOR=$(jq -r '.cursor // 0' "$CURSOR_FILE" 2>/dev/null || echo "0")
fi

SYNC=$(curl -sf --max-time 5 "${KG_URL}/api/sync?cursor=${CURSOR}&agent_id=${AGENT_ID}&cross_namespace=true" 2>/dev/null)
SYNC_COUNT=0
if [ -n "$SYNC" ]; then
  NEW_CURSOR=$(echo "$SYNC" | jq -r '.cursor')
  SYNC_COUNT=$(echo "$SYNC" | jq '.events | length' 2>/dev/null || echo "0")

  if [ -n "$NEW_CURSOR" ] && [ "$NEW_CURSOR" != "null" ] && [ "$NEW_CURSOR" -gt "$CURSOR" ] 2>/dev/null; then
    echo "{\"cursor\":${NEW_CURSOR},\"updated\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > "$CURSOR_FILE"
  fi
fi

# ── Output ──

# Stats line
STATS=$(curl -sf --max-time 3 "${KG_URL}/api/stats" 2>/dev/null)
NODES=$(echo "$STATS" | jq -r '.nodes // "?"' 2>/dev/null)
EDGES=$(echo "$STATS" | jq -r '.edges // "?"' 2>/dev/null)
echo "KG: ${NODES} nodes, ${EDGES} edges | push: ${PUSH_COUNT} | sync: ${SYNC_COUNT} new events"

# Push content (the main value — contextually relevant knowledge)
if [ "$PUSH_COUNT" -gt 0 ] && [ -n "$PUSH_TEXT" ]; then
  echo ""
  echo "$PUSH_TEXT"
  echo ""
  echo "To mark pushed knowledge as useful: <kuro:kg-feedback push_id=\"PUSH_ID\" useful=\"true\"/>"
fi

# Sync summary (brief)
if [ "$SYNC_COUNT" -gt 0 ] 2>/dev/null && [ "$SYNC_COUNT" -le 10 ] 2>/dev/null; then
  echo ""
  echo "Recent KG updates:"
  echo "$SYNC" | jq -r '.events[-5:] | .[] | "  - \(.data.name // .entity_id[0:8]) (\(.type))"' 2>/dev/null
elif [ "$SYNC_COUNT" -gt 10 ] 2>/dev/null; then
  echo ""
  echo "${SYNC_COUNT} new KG events (use /kg-query to explore)"
fi
