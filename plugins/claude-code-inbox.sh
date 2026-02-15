#!/bin/bash
# Claude Code Inbox — 感知 Claude Code 的異步通知
#
# Claude Code 寫入 ~/.mini-agent/claude-code-inbox.md（不走 /chat API）
# 此 plugin 讀取並清空，Kuro 在下一個 cycle 自然看到
# stdout 會被包在 <claude-code-inbox>...</claude-code-inbox> 中注入 context

INBOX="$HOME/.mini-agent/claude-code-inbox.md"

if [ ! -f "$INBOX" ] || [ ! -s "$INBOX" ]; then
    echo "No messages."
    exit 0
fi

# Read content
content=$(cat "$INBOX")

# Clear inbox (atomic: truncate after read)
> "$INBOX"

echo "$content"
