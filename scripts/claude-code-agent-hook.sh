#!/bin/bash
# Claude Code UserPromptSubmit Hook — Agent 狀態自動注入
#
# 每次 Alex 在 Claude Code 送出 prompt 時自動執行
# stdout 作為 additionalContext 注入 Claude 的 context
# 讓 Claude Code 自動知道 Agent 的最新狀態

AGENT_URL="${AGENT_URL:-http://localhost:3001}"
API_KEY="${MINI_AGENT_API_KEY:-}"

AUTH_HEADER=""
if [ -n "$API_KEY" ]; then
    AUTH_HEADER="-H X-API-Key:$API_KEY"
fi

# 1. Get agent name + status (2s timeout, fail silently)
INFO=$(curl -sf --max-time 2 $AUTH_HEADER "$AGENT_URL/api/instance" 2>/dev/null)
if [ -z "$INFO" ]; then
    # Agent offline — skip silently
    exit 0
fi

NAME=$(echo "$INFO" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('name') or d.get('config',{}).get('name','Agent'))" 2>/dev/null || echo "Agent")
NAME_LOWER=$(echo "$NAME" | tr '[:upper:]' '[:lower:]')

STATUS=$(curl -sf --max-time 2 $AUTH_HEADER "$AGENT_URL/status" 2>/dev/null)
if [ -z "$STATUS" ]; then
    echo "[$NAME 即時狀態] Offline or unreachable"
    exit 0
fi

# Parse status fields
LOOP_MODE=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('loop',{}).get('mode','unknown'))" 2>/dev/null || echo "unknown")
LOOP_RUNNING=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(str(d.get('loop',{}).get('running',False)).lower())" 2>/dev/null || echo "unknown")
CYCLE_COUNT=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('loop',{}).get('cycleCount',0))" 2>/dev/null || echo "0")
CLAUDE_BUSY=$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); print(str(d.get('claude',{}).get('busy',False)).lower())" 2>/dev/null || echo "unknown")

# 2. Get most recent agent reply from Chat Room
TODAY=$(date +%Y-%m-%d)
RECENT=$(curl -sf --max-time 2 $AUTH_HEADER \
    "$AGENT_URL/api/room?date=$TODAY" 2>/dev/null | \
    python3 -c "
import sys,json
try:
    msgs = json.load(sys.stdin).get('messages',[])
    agent = [m for m in msgs if m.get('from')=='$NAME_LOWER']
    if agent:
        text = agent[-1].get('text','')
        print(text[:200] + ('...' if len(text)>200 else ''))
except:
    pass
" 2>/dev/null)

# 3. Output context
echo "[$NAME 即時狀態]"
echo "- Loop: $LOOP_MODE (running=$LOOP_RUNNING, cycles=$CYCLE_COUNT)"
echo "- Claude busy: $CLAUDE_BUSY"
if [ -n "$RECENT" ]; then
    echo "- $NAME 最近回覆: $RECENT"
fi
echo "- 可用 MCP 工具: agent_discuss, agent_chat, agent_status, agent_context, agent_logs"
