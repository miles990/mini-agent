#!/bin/bash
# Team Chat Room — Terminal Helper
#
# Usage:
#   room "訊息"              → 以 alex 身份發訊息
#   room --read              → 讀今日對話
#   room --read 2026-02-22   → 讀指定日期對話
#   room --watch             → SSE 即時監聽
#   room --from kuro "訊息"  → 指定身份發訊息

BASE_URL="${MINI_AGENT_URL:-http://localhost:3001}"
API_KEY="${MINI_AGENT_API_KEY}"
AUTH_HEADER="x-api-key: $API_KEY"

case "$1" in
  --read)
    DATE="${2:-$(date +%Y-%m-%d)}"
    curl -sf "$BASE_URL/api/room?date=$DATE" -H "$AUTH_HEADER" | jq -r '.messages[] | "\(.ts[11:16]) [\(.from)] \(.text)"'
    ;;
  --watch)
    echo "Watching chat room... (Ctrl+C to stop)"
    curl -sfN "$BASE_URL/api/room/stream" -H "$AUTH_HEADER"
    ;;
  --from)
    FROM="$2"
    shift 2
    TEXT="$*"
    if [ -z "$TEXT" ]; then echo "Usage: room --from <identity> <message>"; exit 1; fi
    curl -sf -X POST "$BASE_URL/api/room" \
      -H "$AUTH_HEADER" \
      -H "Content-Type: application/json" \
      -d "{\"from\":\"$FROM\",\"text\":\"$TEXT\"}" | jq .
    ;;
  --help|-h)
    echo "Team Chat Room CLI"
    echo ""
    echo "Usage:"
    echo "  room \"message\"              Send as alex"
    echo "  room --from kuro \"message\"  Send as specific identity"
    echo "  room --read [YYYY-MM-DD]    Read conversation"
    echo "  room --watch                Watch live (SSE)"
    ;;
  *)
    TEXT="$*"
    if [ -z "$TEXT" ]; then echo "Usage: room <message> (see room --help)"; exit 1; fi
    curl -sf -X POST "$BASE_URL/api/room" \
      -H "$AUTH_HEADER" \
      -H "Content-Type: application/json" \
      -d "{\"from\":\"alex\",\"text\":\"$TEXT\"}" | jq .
    ;;
esac
