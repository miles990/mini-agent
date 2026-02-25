#!/bin/bash
# Claude Code Sessions — 感知 Claude Code 互動 session
#
# 偵測是否有 Claude Code 互動 session 在執行
# 讓 Agent 知道 Alex 正在用 Claude Code / Remote Control
# Category: workspace (30s interval)

# Count claude processes — exclude mini-agent's own -p subprocess calls
# claude interactive sessions typically show as "claude" without -p flag
INTERACTIVE=0
RC=0
MCP=0

# Find claude processes
if command -v pgrep &>/dev/null; then
    # Get all claude processes (not grep itself)
    CLAUDE_PIDS=$(pgrep -f "claude" 2>/dev/null | head -20)

    if [ -n "$CLAUDE_PIDS" ]; then
        while IFS= read -r pid; do
            # Get full command line
            CMD=$(ps -p "$pid" -o args= 2>/dev/null || continue)

            # Skip mini-agent's own subprocess calls (claude -p "...")
            if echo "$CMD" | grep -q ' -p '; then
                continue
            fi

            # Skip grep and this script itself
            if echo "$CMD" | grep -qE '(grep|claude-code-sessions)'; then
                continue
            fi

            # Skip node processes that aren't claude
            if echo "$CMD" | grep -q '^node.*mcp-server'; then
                MCP=$((MCP + 1))
                continue
            fi

            # Interactive claude session
            if echo "$CMD" | grep -qE '(^claude|/claude)(\s|$)'; then
                INTERACTIVE=$((INTERACTIVE + 1))
            fi
        done <<< "$CLAUDE_PIDS"
    fi
fi

# Check if Remote Control is active (claude --rc creates a specific process pattern)
# RC sessions show up in Claude Code's /rc command output
if [ "$INTERACTIVE" -gt 0 ]; then
    # Check for RC-related indicators
    RC_CHECK=$(ps aux 2>/dev/null | grep -c "claude.*remote\|claude.*rc" || echo 0)
    if [ "$RC_CHECK" -gt 0 ]; then
        RC=1
    fi
fi

# Output
if [ "$INTERACTIVE" -eq 0 ] && [ "$MCP" -eq 0 ]; then
    echo "No active Claude Code sessions."
else
    echo "Interactive: $INTERACTIVE, MCP connections: $MCP"
    if [ "$RC" -gt 0 ]; then
        echo "Remote Control: active (Alex can control remotely)"
    fi
    if [ "$INTERACTIVE" -gt 0 ]; then
        echo "Alex may be actively working in Claude Code."
    fi
fi
