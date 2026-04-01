#!/bin/bash
# Agora Inbox — Poll Agent Discussion Service for new messages
#
# Reads from Agora API, tracks cursor per discussion.
# stdout 會被包在 <agora-inbox>...</agora-inbox> 中注入 context

AGORA_URL="${AGORA_URL:-http://localhost:3004}"
AGORA_API_KEY="${AGORA_API_KEY:-}"
CURSOR_FILE="$HOME/.mini-agent/state/agora-cursors.json"

# Bail if no API key
if [ -z "$AGORA_API_KEY" ]; then
    echo "Not configured (no AGORA_API_KEY)."
    exit 0
fi

# Check server reachable (1s timeout)
if ! curl -sf --max-time 1 "$AGORA_URL/discussions" -H "x-api-key: $AGORA_API_KEY" > /dev/null 2>&1; then
    echo "Agora server unreachable ($AGORA_URL)."
    exit 0
fi

# Ensure state dir
mkdir -p "$(dirname "$CURSOR_FILE")"

# Load cursors
if [ -f "$CURSOR_FILE" ]; then
    CURSORS=$(cat "$CURSOR_FILE")
else
    CURSORS='{}'
fi

# Get discussions list
DISCUSSIONS=$(curl -sf --max-time 5 "$AGORA_URL/discussions" -H "x-api-key: $AGORA_API_KEY" 2>/dev/null)
if [ -z "$DISCUSSIONS" ] || [ "$DISCUSSIONS" = "[]" ]; then
    echo "No active discussions."
    exit 0
fi

TOTAL_NEW=0
OUTPUT=""

# Iterate discussions
for disc_id in $(echo "$DISCUSSIONS" | python3 -c "import sys,json; [print(d['id']) for d in json.load(sys.stdin)]" 2>/dev/null); do
    # Get cursor for this discussion
    since=$(echo "$CURSORS" | python3 -c "import sys,json; c=json.load(sys.stdin); print(c.get('$disc_id',''))" 2>/dev/null)

    # Build URL
    url="$AGORA_URL/discussions/$disc_id/messages?limit=20"
    [ -n "$since" ] && url="$url&since=$since"

    # Fetch messages
    MESSAGES=$(curl -sf --max-time 5 "$url" -H "x-api-key: $AGORA_API_KEY" 2>/dev/null)
    if [ -z "$MESSAGES" ] || [ "$MESSAGES" = "[]" ]; then
        continue
    fi

    # Count new messages
    count=$(echo "$MESSAGES" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)
    if [ "$count" = "0" ] || [ -z "$count" ]; then
        continue
    fi

    # Get discussion topic and phase
    disc_info=$(echo "$DISCUSSIONS" | python3 -c "
import sys,json
for d in json.load(sys.stdin):
    if d['id'] == '$disc_id':
        print(f\"{d['topic']}|{d['phase']}|{d['messageCount']}\")
        break
" 2>/dev/null)
    topic=$(echo "$disc_info" | cut -d'|' -f1)
    phase=$(echo "$disc_info" | cut -d'|' -f2)
    msg_count=$(echo "$disc_info" | cut -d'|' -f3)

    TOTAL_NEW=$((TOTAL_NEW + count))

    # Format messages
    disc_output=$(echo "$MESSAGES" | python3 -c "
import sys, json
msgs = json.load(sys.stdin)
for m in msgs:
    reply = f' ↩{m[\"replyTo\"]}' if m.get('replyTo') else ''
    mentions = f' @{\" @\".join(m[\"mentions\"])}' if m.get('mentions') else ''
    mtype = f' [{m[\"type\"]}]' if m.get('type', 'message') != 'message' else ''
    text = m['text'][:200]
    print(f'  [{m[\"id\"]}] {m[\"from\"]}{reply}{mtype}: {text}')
" 2>/dev/null)

    OUTPUT="${OUTPUT}
--- ${topic} (${phase}, ${msg_count} msgs) ---
${disc_output}"

    # Update cursor to last message ID
    last_id=$(echo "$MESSAGES" | python3 -c "import sys,json; msgs=json.load(sys.stdin); print(msgs[-1]['id'] if msgs else '')" 2>/dev/null)
    if [ -n "$last_id" ]; then
        CURSORS=$(echo "$CURSORS" | python3 -c "
import sys, json
c = json.load(sys.stdin)
c['$disc_id'] = '$last_id'
print(json.dumps(c))
" 2>/dev/null)
    fi
done

# Save updated cursors
echo "$CURSORS" > "$CURSOR_FILE"

# Output
if [ "$TOTAL_NEW" -eq 0 ]; then
    # Show discussion overview even without new messages
    overview=$(echo "$DISCUSSIONS" | python3 -c "
import sys, json
for d in json.load(sys.stdin):
    print(f\"  {d['id']}: {d['topic']} ({d['phase']}, {d['messageCount']} msgs)\")
" 2>/dev/null)
    echo "=== Agora: No new messages ==="
    echo "$overview"
else
    echo "=== Agora: $TOTAL_NEW new message(s) ==="
    echo "$OUTPUT"
fi
