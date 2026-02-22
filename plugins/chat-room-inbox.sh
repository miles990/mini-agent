#!/bin/bash
# Chat Room Inbox — 感知 Chat Room 的待處理訊息
#
# POST /api/room 寫入 ~/.mini-agent/chat-room-inbox.md（## Pending section）
# 此 plugin 讀取 pending messages，不清空（由 loop.ts markChatRoomInboxProcessed 處理）
# stdout 會被包在 <chat-room-inbox>...</chat-room-inbox> 中注入 context

INBOX="$HOME/.mini-agent/chat-room-inbox.md"

if [ ! -f "$INBOX" ] || [ ! -s "$INBOX" ]; then
    echo "No messages."
    exit 0
fi

# Count pending messages
pending=$(sed -n '/^## Pending$/,/^## Processed$/p' "$INBOX" 2>/dev/null | grep -c '^\- \[' || echo 0)

if [ "$pending" -eq 0 ]; then
    echo "No pending messages."
    exit 0
fi

echo "=== $pending pending message(s) from Chat Room ==="

# Show pending messages
sed -n '/^## Pending$/,/^## Processed$/p' "$INBOX" 2>/dev/null | grep '^\- \[' | head -10 | while IFS= read -r line; do
    echo "  $line"
done

# Show recent processed (last 3)
recent=$(grep -A 999 '^## Processed$' "$INBOX" 2>/dev/null | grep '^\- \[' | head -3)
if [ -n "$recent" ]; then
    echo ""
    echo "--- Recent processed ---"
    echo "$recent" | while IFS= read -r line; do
        echo "  $line"
    done
fi
