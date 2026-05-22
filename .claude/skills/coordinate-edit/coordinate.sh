#!/usr/bin/env bash
# coordinate.sh — pre-edit coordination ritual for the shared mini-agent tree.
# Kuro and Claude Code both write here; this checks before you touch src/ or memory/.
#
# Usage:
#   coordinate.sh                    # read-only: Kuro state + branch + checklist
#   coordinate.sh --announce "msg"   # also post a claim to the chat-room
#
set -euo pipefail

API="http://127.0.0.1:3001"
ANNOUNCE=""
if [ "${1:-}" = "--announce" ]; then ANNOUNCE="${2:-}"; fi

echo "=== coordinate-edit ==="

# 1. Kuro cycle state
STATUS=$(curl -sf -m 5 "$API/status" 2>/dev/null || echo "")
if [ -z "$STATUS" ]; then
  echo "Kuro: offline (無法取得 status) — 仍建議走 worktree"
else
  BUSY=$(echo "$STATUS" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("claude",{}).get("busy"))' 2>/dev/null || echo "?")
  echo "Kuro: busy=$BUSY"
  if [ "$BUSY" = "True" ]; then
    echo "  ⚠ Kuro 在 active cycle — 改 src/ 或 memory/ 前務必先宣告，並用 worktree 隔離"
  fi
fi

# 2. Current branch
BR=$(git branch --show-current 2>/dev/null || echo "?")
echo "Branch: $BR"
if [ "$BR" = "runtime/main" ]; then
  echo "  ⚠ runtime/main 是部署鏡像分支 — tracked 改動會被 autocorrect 洗掉。"
  echo "    用 scripts/forge-lite.sh create <name> 走 worktree。"
fi

# 3. Optional room announcement
if [ -n "$ANNOUNCE" ]; then
  RES=$(curl -sf -m 5 -X POST -H 'Content-Type: application/json' \
    -H "X-API-Key: ${MINI_AGENT_API_KEY:-}" \
    -d "{\"from\":\"claude-code\",\"text\":\"$ANNOUNCE\"}" \
    "$API/api/room" 2>/dev/null || echo "")
  if [ -n "$RES" ]; then echo "Room: 已宣告 — $RES"; else echo "Room: 宣告失敗（Kuro offline?）"; fi
fi

# 4. Pre-action checklist
cat <<'EOF'

--- 動手前確認 ---
[ ] 已在 chat-room 宣告要改的檔案（衝突時讓先宣告者優先）
[ ] 大改動（>3 files OR >50 lines）→ forge-lite.sh create <name> 走 worktree
[ ] 不在 runtime/main 上 commit tracked 檔案
EOF
