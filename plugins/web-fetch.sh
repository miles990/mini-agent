#!/bin/bash
# Web 五層擷取感知 — curl → Jina Reader → CDP → Pinchtab → 人工
# stdout 會被包在 <web>...</web> 中注入 Agent context

PINCHTAB_PORT="${PINCHTAB_PORT:-9867}"
PINCHTAB_BASE="http://localhost:$PINCHTAB_PORT"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PINCHTAB_FETCH="$SCRIPT_DIR/scripts/pinchtab-fetch.sh"
CDP_FETCH="$SCRIPT_DIR/scripts/cdp-fetch.mjs"

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

# Check if Chrome CDP is available (port 9222)
CDP_AVAILABLE=false
if curl -s --max-time 2 "http://localhost:${CDP_PORT:-9222}/json/version" > /dev/null 2>&1; then
  CDP_AVAILABLE=true
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
    # Check if it's an auth/login page or too short (JS-heavy)
    IS_AUTH=$(echo "$CONTENT" | head -100 | grep -ciE 'sign.in|log.in|login|password|captcha|verify|驗證|登入|403|forbidden|unauthorized' || true)
    CONTENT_LEN=${#CONTENT}

    if [[ "$IS_AUTH" -lt 2 ]] && [[ "$CONTENT_LEN" -gt 200 ]]; then
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

  # Layer 2: Try Jina Reader (JS-heavy public pages, clean markdown output)
  JINA_RESULT=$(curl -sL --max-time 15 \
    -H "Accept: text/markdown" \
    "https://r.jina.ai/$URL" 2>/dev/null)
  JINA_EXIT=$?
  JINA_LEN=${#JINA_RESULT}

  if [[ $JINA_EXIT -eq 0 ]] && [[ "$JINA_LEN" -gt 200 ]]; then
    # Check if Jina also got auth/error page
    JINA_AUTH=$(echo "$JINA_RESULT" | head -20 | grep -ciE 'sign.in|log.in|login|password|captcha|403|forbidden|unauthorized' || true)
    if [[ "$JINA_AUTH" -lt 2 ]]; then
      echo "  [via Jina Reader]"
      echo "$JINA_RESULT" | head -60
      echo ""
      continue
    fi
  fi

  # Layer 3: Try Chrome CDP (authenticated pages via user's Chrome session)
  if [[ "$CDP_AVAILABLE" == "true" ]] && [[ -f "$CDP_FETCH" ]]; then
    echo "  [curl+Jina failed, trying Chrome CDP...]"
    CDP_RESULT=$(node "$CDP_FETCH" fetch "$URL" 2>/dev/null)
    CDP_EXIT=$?

    if [[ $CDP_EXIT -eq 0 ]] && [[ -n "$CDP_RESULT" ]]; then
      if echo "$CDP_RESULT" | head -1 | grep -q "AUTH_REQUIRED"; then
        echo "  [Login required even in Chrome]"
        echo "  To access: node scripts/cdp-fetch.mjs open \"$URL\""
        echo "  Then: node scripts/cdp-fetch.mjs extract <tabId>"
      else
        echo "$CDP_RESULT" | head -40
      fi
      echo ""
      continue
    fi
  fi

  # Layer 4: Try Pinchtab headless (stealth browser)
  if [[ "$PINCHTAB_AVAILABLE" == "true" ]]; then
    echo "  [trying Pinchtab headless...]"
    PINCHTAB_RESULT=$(bash "$PINCHTAB_FETCH" fetch "$URL" 2>/dev/null)
    PINCHTAB_EXIT=$?

    if [[ $PINCHTAB_EXIT -eq 0 ]] && [[ -n "$PINCHTAB_RESULT" ]]; then
      if echo "$PINCHTAB_RESULT" | head -1 | grep -q "AUTH_REQUIRED"; then
        echo "  [Login required]"
        echo "  This page needs authentication."
      else
        echo "$PINCHTAB_RESULT" | head -40
      fi
      echo ""
      continue
    fi
  fi

  # Layer 5: Cannot access — human assistance
  echo "  [Cannot fetch — requires login or is inaccessible]"
  if [[ "$CDP_AVAILABLE" == "true" ]]; then
    echo "  To open in Chrome: node scripts/cdp-fetch.mjs open \"$URL\""
  elif [[ "$PINCHTAB_AVAILABLE" == "true" ]]; then
    echo "  To open in Chrome: bash scripts/pinchtab-fetch.sh open \"$URL\""
  else
    echo "  No browser available. Start Chrome with --remote-debugging-port=9222"
  fi
  echo ""
done
