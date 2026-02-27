#!/bin/bash
# alex-switch — 切換到 Alex 的 Claude 帳號
#
# 流程：等 Kuro cycle 結束 → pause loop → 備份 Kuro credential → 刪除 keychain → 提示登入
# 用完後跑 alex-done 切回 Kuro

set -e

KURO_API="http://localhost:3001"
KEYCHAIN_SERVICE="Claude Code-credentials"
BACKUP_DIR="$HOME/.mini-agent/auth-backup"

echo "=== Alex Switch ==="

# 1. 確認 Kuro 在線
if ! curl -sf "$KURO_API/health" > /dev/null 2>&1; then
  echo "Kuro 不在線，直接切換 keychain"
fi

# 2. 等 Kuro cycle 結束
if curl -sf "$KURO_API/health" > /dev/null 2>&1; then
  busy=$(curl -sf "$KURO_API/status" | jq -r '.claude.loop.busy')
  if [ "$busy" = "true" ]; then
    echo "等待 Kuro 當前 cycle 結束..."
    while true; do
      sleep 3
      busy=$(curl -sf "$KURO_API/status" | jq -r '.claude.loop.busy')
      if [ "$busy" != "true" ]; then
        break
      fi
      printf "."
    done
    echo ""
  fi

  # 3. Pause Kuro loop
  echo "Pausing Kuro loop..."
  curl -sf -X POST "$KURO_API/loop/pause" > /dev/null
  echo "  Loop paused"
fi

# 4. 備份 Kuro 的 credential
mkdir -p "$BACKUP_DIR"
kuro_cred=$(security find-generic-password -s "$KEYCHAIN_SERVICE" -w 2>/dev/null || echo "")
if [ -n "$kuro_cred" ]; then
  echo "$kuro_cred" > "$BACKUP_DIR/kuro-credential.json"
  chmod 600 "$BACKUP_DIR/kuro-credential.json"
  echo "  Kuro credential backed up"
fi

# 5. 刪除 keychain credential（讓 claude 重新登入）
security delete-generic-password -s "$KEYCHAIN_SERVICE" > /dev/null 2>&1 || true
echo "  Keychain cleared"

echo ""
echo "Done! 現在開新 terminal 跑 claude，會自動要求登入。"
echo "  選擇你自己的帳號登入。"
echo "  Kuro loop 已暫停，不會用到你的額度。"
echo "  用完後跑: alex-done"
