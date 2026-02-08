#!/bin/bash
# Chrome CDP 自動診斷 + 修復
# Agent 直接執行此腳本，不需要用戶手動操作
#
# Exit codes: 0 = 成功, 1 = 失敗（附診斷）
# 輸出格式: STATUS: message （Agent 解析用）
#
# Chrome 144+ 要求 --user-data-dir 才能啟用 remote debugging
# 使用 ~/.mini-agent/chrome-cdp-profile 作為專用 profile
# 登入狀態會保留在此 profile 中（重啟不丟失）

CDP_PORT="${CDP_PORT:-9222}"
CDP_BASE="http://localhost:$CDP_PORT"
CDP_PROFILE="${CDP_PROFILE:-$HOME/.mini-agent/chrome-cdp-profile}"

# ── Step 1: 已經可用？ ──
if curl -s --max-time 2 "$CDP_BASE/json/version" > /dev/null 2>&1; then
  BROWSER=$(curl -s --max-time 2 "$CDP_BASE/json/version" | python3 -c "import sys,json; print(json.load(sys.stdin).get('Browser','Chrome'))" 2>/dev/null)
  TABS=$(curl -s --max-time 2 "$CDP_BASE/json" | python3 -c "import sys,json; print(len([t for t in json.load(sys.stdin) if t.get('type')=='page']))" 2>/dev/null)
  echo "STATUS: OK"
  echo "Browser: $BROWSER"
  echo "Tabs: $TABS"
  echo "Port: $CDP_PORT"
  exit 0
fi

# ── Step 2: Port 被其他程式佔用？ ──
PORT_PID=$(lsof -ti :"$CDP_PORT" 2>/dev/null | head -1)
if [[ -n "$PORT_PID" ]]; then
  PORT_PROC=$(ps -p "$PORT_PID" -o comm= 2>/dev/null)
  if [[ "$PORT_PROC" != *"Chrome"* ]] && [[ "$PORT_PROC" != *"chrome"* ]]; then
    echo "STATUS: PORT_CONFLICT"
    echo "Port $CDP_PORT is used by: $PORT_PROC (PID: $PORT_PID)"
    echo "Fix: Use different port (CDP_PORT=9223) or kill PID $PORT_PID"
    exit 1
  fi
fi

# ── Step 3: Chrome 沒安裝？ ──
if [[ ! -d "/Applications/Google Chrome.app" ]]; then
  echo "STATUS: NOT_INSTALLED"
  echo "Google Chrome is not installed"
  echo "Install: https://www.google.com/chrome/"
  exit 1
fi

# ── Step 4: 關閉現有 Chrome（僅 CDP profile 的） ──
# 檢查是否有用 CDP profile 啟動的 Chrome
CDP_CHROME_PID=$(pgrep -f "user-data-dir.*chrome-cdp-profile" 2>/dev/null | head -1)
if [[ -n "$CDP_CHROME_PID" ]]; then
  echo "PROGRESS: Closing existing CDP Chrome instance..."
  kill "$CDP_CHROME_PID" 2>/dev/null
  sleep 2
  kill -9 "$CDP_CHROME_PID" 2>/dev/null 2>&1
  sleep 1
fi

# ── Step 5: 建立 profile 目錄 + 啟動 ──
mkdir -p "$CDP_PROFILE"

echo "PROGRESS: Launching Chrome CDP (dedicated profile) on port $CDP_PORT..."
nohup "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port="$CDP_PORT" \
  --user-data-dir="$CDP_PROFILE" \
  --no-first-run \
  --no-default-browser-check \
  > /dev/null 2>&1 &

# ── Step 6: 等待並驗證（最多 15 秒） ──
for i in 1 2 3 4 5; do
  sleep 3
  if curl -s --max-time 2 "$CDP_BASE/json/version" > /dev/null 2>&1; then
    BROWSER=$(curl -s --max-time 2 "$CDP_BASE/json/version" | python3 -c "import sys,json; print(json.load(sys.stdin).get('Browser','Chrome'))" 2>/dev/null)
    TABS=$(curl -s --max-time 2 "$CDP_BASE/json" | python3 -c "import sys,json; print(len([t for t in json.load(sys.stdin) if t.get('type')=='page']))" 2>/dev/null)
    echo "STATUS: OK"
    echo "Browser: $BROWSER"
    echo "Tabs: $TABS"
    echo "Port: $CDP_PORT"
    echo "Profile: $CDP_PROFILE"

    # 首次啟動提示
    if [[ "$TABS" == "1" ]] || [[ "$TABS" == "0" ]]; then
      echo "Note: New CDP profile. User may need to login to sites in this browser."
    fi
    exit 0
  fi
  echo "PROGRESS: Waiting for Chrome to start... (attempt $i/5)"
done

# ── Step 7: 啟動失敗 → 診斷 ──
echo "STATUS: FAILED"
echo ""

# 診斷
if ! pgrep -f "Google Chrome" > /dev/null 2>&1; then
  echo "Diagnosis: Chrome process not found after launch"
  echo "Possible: Chrome crashed on startup"
elif lsof -ti :"$CDP_PORT" > /dev/null 2>&1; then
  echo "Diagnosis: Port $CDP_PORT is occupied but CDP not responding"
  echo "Possible: Another Chrome instance is conflicting"
else
  echo "Diagnosis: Chrome running but not listening on port $CDP_PORT"
  echo "Possible: Profile directory permission issue"
fi

echo ""
echo "Manual fix:"
echo "  /Applications/Google\\ Chrome.app/Contents/MacOS/Google\\ Chrome --remote-debugging-port=$CDP_PORT --user-data-dir=$CDP_PROFILE"
exit 1
