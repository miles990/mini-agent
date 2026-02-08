#!/bin/bash
# Telegram Inbox — 讀取未處理的 Telegram 訊息
# stdout 會被包在 <telegram-inbox>...</telegram-inbox> 中注入 Agent context

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MEMORY_DIR="${MINI_AGENT_MEMORY:-$PROJECT_DIR/memory}"
INBOX="$MEMORY_DIR/.telegram-inbox.md"

if [ ! -f "$INBOX" ]; then
    echo "No inbox"
    exit 0
fi

# Count pending messages
pending=$(sed -n '/^## Pending$/,/^## Processed$/p' "$INBOX" 2>/dev/null | grep -c '^- \[' || echo 0)

if [ "$pending" -eq 0 ]; then
    echo "No pending messages"
    exit 0
fi

echo "=== $pending pending message(s) ==="

# Show pending messages
sed -n '/^## Pending$/,/^## Processed$/p' "$INBOX" 2>/dev/null | grep '^- \[' | head -10 | while IFS= read -r line; do
    # Extract timestamp and content
    echo "  $line"
done

# Show recent processed (last 3)
recent=$(grep -A 999 '^## Processed$' "$INBOX" 2>/dev/null | grep '^- \[' | head -3)
if [ -n "$recent" ]; then
    echo ""
    echo "--- Recent replies ---"
    echo "$recent" | while IFS= read -r line; do
        echo "  $line"
    done
fi
