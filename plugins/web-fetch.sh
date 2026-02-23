#!/bin/bash
# Web 三層擷取感知 — curl → Chrome CDP → 提示用戶
# stdout 會被包在 <web>...</web> 中注入 Agent context

PINCHTAB_PORT="${PINCHTAB_PORT:-9867}"
PINCHTAB_BASE="http://localhost:$PINCHTAB_PORT"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PINCHTAB_FETCH="$SCRIPT_DIR/scripts/pinchtab-fetch.sh"

# 讀取最近的對話記錄，提取 URL
INSTANCE_DIR="${MINI_AGENT_INSTANCE_DIR:-$HOME/.mini-agent/instances/default}"
DAILY_DIR="$INSTANCE_DIR/daily"
TODAY=$(date +%Y-%m-%d)
DAILY_FILE="$DAILY_DIR/$TODAY.md"

if [[ ! -f "$DAILY_FILE" ]]; then
  echo "No conversations today"
  exit 0
fi

# 提取最近 3 個 URL（排除內部 API）
URLS=$(grep -oE 'https?://[^ )"'"'"'<>]+' "$DAILY_FILE" 2>/dev/null \
  | grep -v 'localhost' \
  | grep -v '127.0.0.1' \
  | tail -3 \
  | sort -u)

if [[ -z "$URLS" ]]; then
  echo "No URLs in recent conversations"
  exit 0
fi

# Check if Pinchtab is available
PINCHTAB_AVAILABLE=false
if curl -s --max-time 2 "$PINCHTAB_BASE/health" > /dev/null 2>&1; then
  PINCHTAB_AVAILABLE=true
fi

echo "=== Web Content ==="
echo ""

for URL in $URLS; do
  echo "--- $URL ---"

  # Layer 1: Try curl first (fast, public pages)
  CONTENT=$(curl -sL --max-time 8 --max-filesize 1048576 \
    -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
    "$URL" 2>/dev/null)

  if [[ $? -eq 0 ]] && [[ -n "$CONTENT" ]]; then
    # Check if it's an auth/login page
    IS_AUTH=$(echo "$CONTENT" | head -100 | grep -ciE 'sign.in|log.in|login|password|captcha|verify|驗證|登入|403|forbidden|unauthorized' || true)

    if [[ "$IS_AUTH" -lt 2 ]]; then
      # Public page — extract content
      if echo "$CONTENT" | head -5 | grep -qi '<html\|<!doctype'; then
        TITLE=$(echo "$CONTENT" | grep -oi '<title[^>]*>[^<]*</title>' | sed 's/<[^>]*>//g' | head -1)
        TEXT=$(echo "$CONTENT" \
          | sed 's/<script[^>]*>.*<\/script>//gi' \
          | sed 's/<style[^>]*>.*<\/style>//gi' \
          | sed 's/<[^>]*>//g' \
          | tr -s '[:space:]' ' ' \
          | head -c 2000)
        [[ -n "$TITLE" ]] && echo "  Title: $TITLE"
        echo "  Content: ${TEXT:0:1500}"
      else
        echo "  Content: ${CONTENT:0:1500}"
      fi
      echo ""
      continue
    fi
  fi

  # Layer 2: Try Pinchtab (authenticated pages)
  if [[ "$PINCHTAB_AVAILABLE" == "true" ]]; then
    echo "  [curl failed/auth required, trying Pinchtab...]"
    PINCHTAB_RESULT=$(bash "$PINCHTAB_FETCH" fetch "$URL" 2>/dev/null)
    PINCHTAB_EXIT=$?

    if [[ $PINCHTAB_EXIT -eq 0 ]] && [[ -n "$PINCHTAB_RESULT" ]]; then
      # Check if Pinchtab also got auth page
      if echo "$PINCHTAB_RESULT" | head -1 | grep -q "AUTH_REQUIRED"; then
        echo "  [Login required]"
        echo "  This page needs authentication."
        echo "  To access: bash scripts/pinchtab-fetch.sh open \"$URL\""
        echo "  Then: bash scripts/pinchtab-fetch.sh extract <tabId>"
      else
        echo "$PINCHTAB_RESULT" | head -40
      fi
      echo ""
      continue
    fi
  fi

  # Layer 3: Cannot access
  echo "  [Cannot fetch — requires login or is inaccessible]"
  if [[ "$PINCHTAB_AVAILABLE" == "false" ]]; then
    echo "  Pinchtab not available. Run: bash scripts/pinchtab-setup.sh start"
  else
    echo "  To open in Chrome: bash scripts/pinchtab-fetch.sh open \"$URL\""
  fi
  echo ""
done
