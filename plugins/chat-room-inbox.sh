#!/bin/bash
# Chat Room Inbox — 感知 Chat Room 的待處理訊息
#
# POST /api/room 寫入 ~/.mini-agent/chat-room-inbox.md（## Pending section）
# 此 plugin 讀取 pending + unaddressed messages
# stdout 會被包在 <chat-room-inbox>...</chat-room-inbox> 中注入 context

INBOX="$HOME/.mini-agent/chat-room-inbox.md"

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

# Show pending messages
if [ "$pending" -gt 0 ]; then
    sed -n '/^## Pending$/,/^## \(Unaddressed\|Processed\)$/p' "$INBOX" 2>/dev/null | grep '^\- \[' | head -10 | while IFS= read -r line; do
        echo "  $line"
    done
fi

# Show unaddressed messages with [!] prefix
if [ "$unaddressed" -gt 0 ]; then
    if [ "$pending" -gt 0 ]; then
        echo ""
    fi
    echo "--- Unaddressed (not yet responded) ---"
    sed -n '/^## Unaddressed$/,/^## Processed$/p' "$INBOX" 2>/dev/null | grep '^\- \[' | head -10 | while IFS= read -r line; do
        echo "  [!] $line"
    done
fi

# Show recent processed (last 3)
recent=$(grep -A 999 '^## Processed$' "$INBOX" 2>/dev/null | grep '^\- \[' | head -3)
if [ -n "$recent" ]; then
    echo ""
    echo "--- Recent processed ---"
    echo "$recent" | while IFS= read -r line; do
        echo "  $line"
    done
fi

# Show recent conversation context from JSONL (last 8 messages)
# This gives thread context so Kuro understands what ambiguous messages like "先做" refer to
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TODAY=$(date -u +%Y-%m-%d)
CONV_FILE="$PROJECT_DIR/memory/conversations/$TODAY.jsonl"

if [ -f "$CONV_FILE" ] && [ "$pending" -gt 0 ]; then
    echo ""
    echo "--- Recent conversation (thread context) ---"
    tail -8 "$CONV_FILE" 2>/dev/null | while IFS= read -r line; do
        from=$(echo "$line" | sed -n 's/.*"from":"\([^"]*\)".*/\1/p')
        id=$(echo "$line" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
        text=$(echo "$line" | sed -n 's/.*"text":"\([^"]*\)".*/\1/p' | head -c 150)
        reply=$(echo "$line" | sed -n 's/.*"replyTo":"\([^"]*\)".*/\1/p')
        if [ -n "$from" ] && [ -n "$text" ]; then
            reply_hint=""
            [ -n "$reply" ] && reply_hint=" ↩$reply"
            echo "  [$id] $from$reply_hint: $text"
        fi
    done
fi
