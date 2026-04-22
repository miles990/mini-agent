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

# Build context from multiple signals (best available wins)
CONTEXT=""

# Signal 1: inner-notes (Kuro's current working memory — best signal)
if [ -f "$INNER_NOTES" ] && [ -s "$INNER_NOTES" ]; then
  CONTEXT=$(head -c "$MAX_CONTEXT_CHARS" "$INNER_NOTES" 2>/dev/null | tr '\n' ' ')
fi

# Signal 2: recent topic files (what Kuro has been learning)
if [ -z "$CONTEXT" ]; then
  RECENT_TOPICS=$(ls -t "${PWD}/memory/topics/"*.md 2>/dev/null | head -3 | while read f; do basename "$f" .md; done | tr '\n' ' ')
  if [ -n "$RECENT_TOPICS" ]; then
    CONTEXT="recent focus areas: ${RECENT_TOPICS}"
  fi
fi

# Signal 3: recent git activity (what was actually worked on)
if [ -z "$CONTEXT" ]; then
  GIT_CONTEXT=$(git log --oneline -5 2>/dev/null | cut -d' ' -f2- | tr '\n' ', ' | head -c "$MAX_CONTEXT_CHARS")
  if [ -n "$GIT_CONTEXT" ]; then
    CONTEXT="recent work: ${GIT_CONTEXT}"
  fi
fi

# Signal 4: last resort
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

# ── Pending Discussions: discussions awaiting Kuro's input ──

DISC_TEXT=""
DISC_COUNT=0
DISC_RESULT=$(curl -sf --max-time 3 "${KG_URL}/api/discussions?status=open" 2>/dev/null)
if [ -n "$DISC_RESULT" ]; then
  DISC_TEXT=$(echo "$DISC_RESULT" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    pending = []
    for d in data.get('discussions', []):
        topic = d.get('topic', '')
        # Skip room-date discussions (handled by chat-room-inbox.sh)
        if topic.startswith('room-'):
            continue
        ns = d.get('namespace', '')
        if ns not in ('kuro', 'shared', 'mini-agent'):
            continue
        parts = d.get('participants', [])
        pos_count = d.get('position_count', 0)
        disc_id = d.get('id', '')
        # Check if kuro already has a position in this discussion
        has_kuro_position = 'kuro' in parts and pos_count > 0
        # Show if: kuro is not a participant yet, or discussion has new positions
        if not has_kuro_position or pos_count > 0:
            pending.append(f\"  [{ns}] {topic[:55]} ({pos_count} positions) id:{disc_id[:8]}\")
    # Only show top 3 most relevant
    for line in pending[:3]:
        print(line)
except: pass
" 2>/dev/null)
  if [ -n "$DISC_TEXT" ]; then
    DISC_COUNT=$(echo "$DISC_TEXT" | wc -l | tr -d ' ')
  fi
fi

# ── Output ──

# Stats line
STATS=$(curl -sf --max-time 3 "${KG_URL}/api/stats" 2>/dev/null)
NODES=$(echo "$STATS" | jq -r '.nodes // "?"' 2>/dev/null)
EDGES=$(echo "$STATS" | jq -r '.edges // "?"' 2>/dev/null)
echo "KG: ${NODES} nodes, ${EDGES} edges | push: ${PUSH_COUNT} | sync: ${SYNC_COUNT} new events | discussions: ${DISC_COUNT} pending"

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

# Pending discussions
if [ -n "$DISC_TEXT" ]; then
  echo ""
  echo "Pending KG discussions (respond via <kuro:kg-position disc_id=\"ID\">your position</kuro:kg-position>):"
  echo "$DISC_TEXT"
fi
