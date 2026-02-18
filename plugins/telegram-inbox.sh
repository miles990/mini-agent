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

# Count seen-but-not-replied messages (marked → seen, not → replied)
seen_not_replied=$(grep -A 999 '^## Processed$' "$INBOX" 2>/dev/null | grep '→ seen$' | head -10 | wc -l | tr -d ' ')

header_count=$((pending + seen_not_replied))

if [ "$header_count" -eq 0 ]; then
    echo "No pending messages"
else
    echo "=== ${header_count}"
fi

if [ "$pending" -gt 0 ]; then
    echo "$pending pending message(s) ==="
    echo ""
    # Show pending messages
    sed -n '/^## Pending$/,/^## Processed$/p' "$INBOX" 2>/dev/null | grep '^- \[' | head -10 | while IFS= read -r line; do
        echo "  $line"
    done
fi

# Show seen-but-not-replied (these need attention!)
if [ "$seen_not_replied" -gt 0 ]; then
    if [ "$pending" -eq 0 ]; then
        echo "$seen_not_replied seen-but-not-replied message(s) ==="
    fi
    echo ""
    echo "--- Seen but NOT replied (needs response) ---"
    grep -A 999 '^## Processed$' "$INBOX" 2>/dev/null | grep '→ seen$' | head -5 | while IFS= read -r line; do
        echo "  $line"
    done
fi

# Show recent replied (last 3)
recent=$(grep -A 999 '^## Processed$' "$INBOX" 2>/dev/null | grep '→ replied$' | head -3)
if [ -n "$recent" ]; then
    echo ""
    echo "--- Recent replies ---"
    echo "$recent" | while IFS= read -r line; do
        echo "  $line"
    done
fi
