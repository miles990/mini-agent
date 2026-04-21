#!/bin/bash
# Chat Room Inbox — 感知 Chat Room 的待處理訊息
#
# POST /api/room 寫入 ~/.mini-agent/chat-room-inbox.md（## Pending section）
# 此 plugin 讀取 pending + unaddressed messages
# stdout 會被包在 <chat-room-inbox>...</chat-room-inbox> 中注入 context

INBOX="$HOME/.mini-agent/chat-room-inbox.md"

# Sanitize system-level XML tags from external content to prevent prompt injection.
# Replaces <system-reminder>, <functions>, <tool_result>, etc. with bracket equivalents.
sanitize_tags() {
    sed -E 's/<(\/?(system-reminder|system|functions|function|tool_result|tool_use|antml:[a-z_]+))/＜\1/g; s/(system-reminder|system|functions|function|tool_result|tool_use|antml:[a-z_]+)>/\1＞/g'
}

if [ ! -f "$INBOX" ] || [ ! -s "$INBOX" ]; then
    echo "No messages."
    exit 0
fi

# Count pending messages
pending=$(sed -n '/^## Pending$/,/^## \(Unaddressed\|Processed\)$/p' "$INBOX" 2>/dev/null | grep -c '^\- \[' || echo 0)

# Count unaddressed messages
unaddressed=$(sed -n '/^## Unaddressed$/,/^## Processed$/p' "$INBOX" 2>/dev/null | grep -c '^\- \[' || echo 0)

if [ "$pending" -eq 0 ] && [ "$unaddressed" -eq 0 ]; then
    echo "No pending messages."
    exit 0
fi

# Build header
header=""
if [ "$pending" -gt 0 ] && [ "$unaddressed" -gt 0 ]; then
    header="=== $pending new + $unaddressed reminder(s) from Chat Room ==="
elif [ "$pending" -gt 0 ]; then
    header="=== $pending new message(s) from Chat Room ==="
else
    header="=== $unaddressed reminder(s) from Chat Room ==="
fi
echo "$header"

# Show pending messages (filter out mushi system event noise)
if [ "$pending" -gt 0 ]; then
    sed -n '/^## Pending$/,/^## \(Unaddressed\|Processed\)$/p' "$INBOX" 2>/dev/null | grep '^\- \[' | grep -v '(mushi) \[.*\] \[mushi\]' | head -10 | sanitize_tags | while IFS= read -r line; do
        echo "  $line"
    done
fi

# Show unaddressed messages with [!] prefix (filter out mushi system event noise)
if [ "$unaddressed" -gt 0 ]; then
    if [ "$pending" -gt 0 ]; then
        echo ""
    fi
    echo "--- Unaddressed (not yet responded) ---"
    sed -n '/^## Unaddressed$/,/^## Processed$/p' "$INBOX" 2>/dev/null | grep '^\- \[' | grep -v '(mushi) \[.*\] \[mushi\]' | head -10 | sanitize_tags | while IFS= read -r line; do
        echo "  [!] $line"
    done
fi

# Show recent processed (last 3)
recent=$(grep -A 999 '^## Processed$' "$INBOX" 2>/dev/null | grep '^\- \[' | head -3)
if [ -n "$recent" ]; then
    echo ""
    echo "--- Recent processed ---"
    echo "$recent" | sanitize_tags | while IFS= read -r line; do
        echo "  $line"
    done
fi

# Show recent conversation context — try KG Discussion first, fallback to JSONL
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TODAY=$(date -u +%Y-%m-%d)

if [ "$pending" -gt 0 ]; then
    echo ""
    echo "--- Recent conversation (thread context) ---"

    # Try KG Discussion API (full messages, no truncation)
    kg_result=$(curl -sf -m 2 -X GET "http://localhost:3300/api/discussions?namespace=kuro&status=open" 2>/dev/null)
    disc_id=""
    if [ -n "$kg_result" ]; then
        disc_id=$(echo "$kg_result" | sed -n 's/.*"id":"\([^"]*\)".*"topic":"room-'"$TODAY"'".*/\1/p' | head -1)
        # Also try reversed JSON key order
        [ -z "$disc_id" ] && disc_id=$(echo "$kg_result" | sed -n 's/.*"topic":"room-'"$TODAY"'".*"id":"\([^"]*\)".*/\1/p' | head -1)
    fi

    if [ -n "$disc_id" ]; then
        # KG path — full messages from Discussion API
        kg_disc=$(curl -sf -m 2 "http://localhost:3300/api/discussion/$disc_id?limit=8&offset=0" 2>/dev/null)
        if [ -n "$kg_disc" ] && echo "$kg_disc" | grep -q '"positions"'; then
            echo "$kg_disc" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for p in data.get('positions', [])[-8:]:
        agent = p.get('source_agent', '?')
        desc = p.get('description', '')[:500]
        ts = p.get('created_at', '')[11:16]
        print(f'  [{ts}] {agent}: {desc}')
except: pass
" 2>/dev/null && exit 0
        fi
    fi

    # Fallback: JSONL (truncated but functional)
    CONV_FILE="$PROJECT_DIR/memory/conversations/$TODAY.jsonl"
    if [ -f "$CONV_FILE" ]; then
        tail -8 "$CONV_FILE" 2>/dev/null | while IFS= read -r line; do
            from=$(echo "$line" | sed -n 's/.*"from":"\([^"]*\)".*/\1/p')
            id=$(echo "$line" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
            text=$(echo "$line" | sed -n 's/.*"text":"\([^"]*\)".*/\1/p' | head -c 500 | sanitize_tags)
            reply=$(echo "$line" | sed -n 's/.*"replyTo":"\([^"]*\)".*/\1/p')
            if [ -n "$from" ] && [ -n "$text" ]; then
                reply_hint=""
                [ -n "$reply" ] && reply_hint=" ↩$reply"
                echo "  [$id] $from$reply_hint: $text"
            fi
        done
    fi
fi
