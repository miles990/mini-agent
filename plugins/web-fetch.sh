#!/bin/bash
# Web 六層擷取感知 — curl → Jina Reader → Grok(X) → CDP → Pinchtab → 人工
# stdout 會被包在 <web>...</web> 中注入 Agent context
#
# 每層都有內容品質驗證 — 防止「成功但內容是垃圾」的靜默失敗

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

# ─── Content Quality Gate ─────────────────────────────────────────────────────
# 通用品質驗證 — 防止「有輸出但沒用」的靜默失敗
is_content_useful() {
  local content="$1" url="$2"
  local content_len=${#content}

  # Check for known restriction messages
  local restrict_count
  restrict_count=$(echo "$content" | head -30 | grep -ciE '目前無法查看此內容|此內容目前無法顯示|this content isn.t available|sorry.*this page isn.t available|content.unavailable|you must log in to continue|受限制的內容' || true)
  [[ "$restrict_count" -ge 1 ]] && return 1

  # Social media: short content = likely restriction page
  if echo "$url" | grep -qiE 'facebook\.com|instagram\.com|threads\.net|x\.com|twitter\.com'; then
    [[ "$content_len" -lt 500 ]] && return 1
  fi

  return 0
}

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

  # ── Layer 1: curl (fast, public pages) ──
  CONTENT=$(curl -sL --max-time 8 --max-filesize 1048576 \
    -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" \
    "$URL" 2>/dev/null)

  if [[ $? -eq 0 ]] && [[ -n "$CONTENT" ]]; then
    IS_AUTH=$(echo "$CONTENT" | head -100 | grep -ciE 'sign.in|log.in|login|password|captcha|verify|驗證|登入|403|forbidden|unauthorized' || true)
    CONTENT_LEN=${#CONTENT}

    if [[ "$IS_AUTH" -lt 2 ]] && [[ "$CONTENT_LEN" -gt 200 ]] && is_content_useful "$CONTENT" "$URL"; then
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

  # ── Layer 2: Jina Reader (JS-heavy public pages) ──
  JINA_RESULT=$(curl -sL --max-time 15 \
    -H "Accept: text/markdown" \
    "https://r.jina.ai/$URL" 2>/dev/null)
  JINA_EXIT=$?
  JINA_LEN=${#JINA_RESULT}

  if [[ $JINA_EXIT -eq 0 ]] && [[ "$JINA_LEN" -gt 200 ]] && is_content_useful "$JINA_RESULT" "$URL"; then
    JINA_AUTH=$(echo "$JINA_RESULT" | head -20 | grep -ciE 'sign.in|log.in|login|password|captcha|403|forbidden|unauthorized' || true)
    if [[ "$JINA_AUTH" -lt 2 ]]; then
      echo "  [via Jina Reader]"
      echo "$JINA_RESULT" | head -60
      echo ""
      continue
    fi
  fi

  # ── Layer 3: Grok x_search (X/Twitter native access) ──
  IS_X_URL=$(echo "$URL" | grep -oiE 'x\.com|twitter\.com' || true)
  if [[ -n "$IS_X_URL" ]] && [[ -n "${XAI_API_KEY:-}" ]]; then
    echo "  [trying Grok x_search...]"
    GROK_RESPONSE=$(curl -s --connect-timeout 5 --max-time 15 "https://api.x.ai/v1/responses" \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $XAI_API_KEY" \
      -d "{
        \"model\": \"grok-4-1-fast\",
        \"tools\": [{\"type\": \"x_search\"}],
        \"instructions\": \"Read this tweet/post and return its full content: author, text, engagement stats. Plain text, no markdown.\",
        \"input\": \"$URL\"
      }" 2>/dev/null)

    GROK_TEXT=$(echo "$GROK_RESPONSE" | jq -r '
      [.output[]? | select(.type == "message") | .content[]? | select(.type == "output_text") | .text] | first // empty
    ' 2>/dev/null)

    if [[ -n "$GROK_TEXT" ]] && [[ ${#GROK_TEXT} -gt 50 ]]; then
      echo "  [via Grok x_search]"
      echo "$GROK_TEXT" | head -40
      echo ""
      continue
    fi
  fi

  # ── Layer 4: Chrome CDP (authenticated pages) ──
  if [[ "$CDP_AVAILABLE" == "true" ]] && [[ -f "$CDP_FETCH" ]]; then
    echo "  [curl+Jina failed, trying Chrome CDP...]"
    CDP_RESULT=$(node "$CDP_FETCH" fetch "$URL" 2>/dev/null)
    CDP_EXIT=$?

    if [[ $CDP_EXIT -eq 0 ]] && [[ -n "$CDP_RESULT" ]]; then
      if echo "$CDP_RESULT" | head -1 | grep -q "AUTH_REQUIRED"; then
        echo "  [Login required even in Chrome]"
        echo "  To access: node scripts/cdp-fetch.mjs open \"$URL\""
        echo "  Then: node scripts/cdp-fetch.mjs extract <tabId>"
      elif is_content_useful "$CDP_RESULT" "$URL"; then
        echo "$CDP_RESULT" | head -40
      else
        echo "  [CDP returned restricted content — falling through]"
      fi
      echo ""
      if is_content_useful "$CDP_RESULT" "$URL" || echo "$CDP_RESULT" | head -1 | grep -q "AUTH_REQUIRED"; then
        continue
      fi
    fi
  fi

  # ── Layer 5: Pinchtab (stealth browser, auto content restriction handling) ──
  if [[ "$PINCHTAB_AVAILABLE" == "true" ]]; then
    echo "  [trying Pinchtab...]"
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

  # ── Layer 6: Cannot access — report clearly ──
  echo "  [Cannot fetch — requires login or is inaccessible]"
  if [[ -n "$IS_X_URL" ]] && [[ -z "${XAI_API_KEY:-}" ]]; then
    echo "  Tip: Set XAI_API_KEY to use Grok x_search for X/Twitter posts"
  elif [[ "$PINCHTAB_AVAILABLE" == "true" ]]; then
    echo "  To open in Chrome: bash scripts/pinchtab-fetch.sh open \"$URL\""
  else
    echo "  No browser available. Start Chrome with --remote-debugging-port=9222"
  fi
  echo ""
done
