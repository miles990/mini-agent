#!/bin/bash
# alex-done — 還原 Kuro 的 Claude credential 並恢復 loop
#
# 流程：刪除 Alex credential → 還原 Kuro backup → resume loop

set -e

KURO_API="http://localhost:3001"
KURO_EMAIL="kuro.ai.agent@gmail.com"
KEYCHAIN_SERVICE="Claude Code-credentials"
KEYCHAIN_ACCOUNT="user"
BACKUP_DIR="$HOME/.mini-agent/auth-backup"
BACKUP_FILE="$BACKUP_DIR/kuro-credential.json"

echo "=== Alex Done ==="

# 1. 確認備份存在
if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: 找不到 Kuro 的 credential 備份 ($BACKUP_FILE)"
  echo "  需要手動跑 claude 重新登入 Kuro 帳號"
  exit 1
fi

# 2. 刪除當前 credential（Alex 的）
security delete-generic-password -s "$KEYCHAIN_SERVICE" > /dev/null 2>&1 || true

# 3. 還原 Kuro 的 credential
kuro_cred=$(cat "$BACKUP_FILE")
security add-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w "$kuro_cred"
echo "  Kuro credential restored"

# 4. 驗證
auth_email=$(claude auth status 2>/dev/null | jq -r '.email' 2>/dev/null || echo "unknown")
if [ "$auth_email" = "$KURO_EMAIL" ]; then
  echo "  Verified: $auth_email"
else
  echo "  WARNING: 當前帳號 $auth_email (預期 $KURO_EMAIL)"
  echo "  credential 已還原但可能需要 refresh"
fi

# 5. Resume Kuro loop
if curl -sf "$KURO_API/health" > /dev/null 2>&1; then
  echo "Resuming Kuro loop..."
  curl -sf -X POST "$KURO_API/loop/resume" > /dev/null
  echo "  Loop resumed"
else
  echo "Kuro 不在線，credential 已還原但 loop 需手動啟動"
fi

echo ""
echo "Done! Kuro 帳號已恢復，loop 已繼續。"
