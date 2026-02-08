#!/bin/bash
# Chrome CDP 自動設定腳本
# 讓 Chrome 啟動時自動開啟 remote debugging port
#
# 使用方式：
#   bash scripts/chrome-setup.sh          # 互動式引導
#   bash scripts/chrome-setup.sh --auto   # 自動設定（macOS）

set -euo pipefail

CDP_PORT="${CDP_PORT:-9222}"
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Chrome CDP Setup — mini-agent browser access"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Step 1: Check current status
echo "1. 檢查 Chrome CDP 狀態..."
if curl -s --max-time 2 "http://localhost:$CDP_PORT/json/version" > /dev/null 2>&1; then
  echo -e "   ${GREEN}✓ Chrome CDP 已在 port $CDP_PORT 運行${NC}"
  echo ""
  echo "   已經設定好了！你可以直接使用："
  echo "   node scripts/cdp-fetch.mjs status"
  exit 0
fi
echo -e "   ${YELLOW}⚠ Chrome CDP 尚未啟用${NC}"
echo ""

# Step 2: Detect OS
OS="$(uname -s)"
case "$OS" in
  Darwin)
    echo "2. 偵測到 macOS"
    echo ""

    # Check if Chrome is installed
    CHROME_APP="/Applications/Google Chrome.app"
    if [[ ! -d "$CHROME_APP" ]]; then
      echo -e "   ${RED}✗ 找不到 Google Chrome${NC}"
      echo "   請先安裝 Chrome: https://www.google.com/chrome/"
      exit 1
    fi
    echo -e "   ${GREEN}✓ Chrome 已安裝${NC}"

    # Check if Chrome is running
    if pgrep -f "Google Chrome" > /dev/null 2>&1; then
      echo -e "   ${YELLOW}⚠ Chrome 正在運行（需要重啟才能啟用 CDP）${NC}"
      echo ""
      echo "   選項 A: 關閉 Chrome 後重新啟動"
      echo "   選項 B: 設定為永久開啟（下次啟動生效）"
      echo ""

      if [[ "${1:-}" == "--auto" ]]; then
        CHOICE="b"
      else
        read -p "   選擇 (a/b): " CHOICE
      fi

      case "${CHOICE,,}" in
        a)
          echo ""
          echo "   關閉 Chrome..."
          osascript -e 'tell application "Google Chrome" to quit' 2>/dev/null || true
          sleep 2
          echo "   重新啟動 Chrome with CDP..."
          open -a "Google Chrome" --args --remote-debugging-port=$CDP_PORT
          sleep 3
          ;;
        b|*)
          # Set up permanent defaults
          echo ""
          echo "3. 設定 Chrome 啟動參數..."
          ;;
      esac
    else
      echo "   Chrome 未在運行"
      echo ""

      if [[ "${1:-}" != "--auto" ]]; then
        read -p "   是否立即啟動 Chrome with CDP? (y/n): " START
        if [[ "${START,,}" != "y" ]]; then
          echo "   跳過啟動。"
        else
          open -a "Google Chrome" --args --remote-debugging-port=$CDP_PORT
          sleep 3
        fi
      fi
    fi

    # Create a helper script for easy launch
    HELPER="$HOME/.local/bin/chrome-cdp"
    mkdir -p "$(dirname "$HELPER")"
    cat > "$HELPER" << 'SCRIPT'
#!/bin/bash
# Launch Chrome with CDP enabled
CDP_PORT="${CDP_PORT:-9222}"

# Check if already running with CDP
if curl -s --max-time 2 "http://localhost:$CDP_PORT/json/version" > /dev/null 2>&1; then
  echo "Chrome CDP already running on port $CDP_PORT"
  exit 0
fi

# If Chrome is running without CDP, inform user
if pgrep -f "Google Chrome" > /dev/null 2>&1; then
  echo "Chrome is running but CDP is not enabled."
  echo "Please quit Chrome first, then run this again."
  echo ""
  echo "Or restart Chrome with CDP:"
  echo "  osascript -e 'tell application \"Google Chrome\" to quit'"
  echo "  sleep 2 && chrome-cdp"
  exit 1
fi

# Start Chrome with CDP
open -a "Google Chrome" --args --remote-debugging-port=$CDP_PORT
echo "Chrome started with CDP on port $CDP_PORT"
SCRIPT
    chmod +x "$HELPER"
    echo -e "   ${GREEN}✓ 建立快速啟動命令: chrome-cdp${NC}"

    # Create a shell alias suggestion
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    # Verify
    if curl -s --max-time 3 "http://localhost:$CDP_PORT/json/version" > /dev/null 2>&1; then
      echo -e "${GREEN}✓ Chrome CDP 設定成功！${NC}"
      echo ""
      echo "測試指令："
      echo "  node scripts/cdp-fetch.mjs status"
      echo "  node scripts/cdp-fetch.mjs fetch https://example.com"
    else
      echo -e "${YELLOW}設定已完成。下次啟動 Chrome 時 CDP 將可用。${NC}"
      echo ""
      echo "啟動方式："
      echo "  chrome-cdp                                  # 快速啟動"
      echo "  open -a 'Google Chrome' --args --remote-debugging-port=$CDP_PORT  # 手動"
    fi

    echo ""
    echo "mini-agent 將自動偵測 Chrome CDP 並使用瀏覽器能力。"
    ;;

  Linux)
    echo "2. 偵測到 Linux"
    echo ""
    echo "啟動 Chrome with CDP:"
    echo "  google-chrome --remote-debugging-port=$CDP_PORT &"
    echo ""
    echo "或 Chromium:"
    echo "  chromium-browser --remote-debugging-port=$CDP_PORT &"
    ;;

  *)
    echo "2. 偵測到 $OS"
    echo ""
    echo "請手動啟動 Chrome with remote debugging:"
    echo "  chrome.exe --remote-debugging-port=$CDP_PORT"
    ;;
esac
