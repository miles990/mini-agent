#!/bin/bash
# Web 自適應擷取感知 — Three-Layer Extraction + Adaptive Domain Router
# stdout 會被包在 <web>...</web> 中注入 Agent context
#
# Three-Layer Architecture (2026-03-07):
#   Layer 1a: Readability + Turndown → LLM-optimized markdown (primary)
#   Layer 1b: Trafilatura (Python) → clean text fallback
#   Layer 1c: sed regex → last-resort text extraction
#   Layer 2:  VLM visual extraction (screenshot → Claude Vision)
#   Layer 3:  Adaptive fetch cascade (curl/jina/stealth/grok/cdp)
#
# Previous evolution (2026-03-05):
#   - Adaptive routing: remember which layer works for each domain
#   - Function-based layers: try preferred first, then cascade
#   - Scrapling-inspired: stealth curl + HTTP/2 + profile rotation + quality gate

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CDP_FETCH="$SCRIPT_DIR/scripts/cdp-fetch.mjs"
STEALTH_FETCH="$SCRIPT_DIR/scripts/stealth-fetch.py"

# Load .env for API keys (XAI_API_KEY etc.) — launchd doesn't pass them
if [[ -f "$SCRIPT_DIR/.env" ]]; then
  set -a; source "$SCRIPT_DIR/.env"; set +a
fi

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

# ─── Full Content Cache ───────────────────────────────────────────────────────
WEB_CACHE_DIR="$HOME/.mini-agent/web-cache"
mkdir -p "$WEB_CACHE_DIR"

cache_content() {
  local url="$1" layer="$2" content="$3" title="${4:-}"
  local url_hash
  url_hash=$(echo -n "$url" | md5 -q 2>/dev/null || echo -n "$url" | md5sum 2>/dev/null | cut -d' ' -f1)
  local short_hash="${url_hash:0:12}"
  local cache_file="$WEB_CACHE_DIR/${short_hash}.txt"

  {
    echo "URL: $url"
    [[ -n "$title" ]] && echo "Title: $title"
    echo "Layer: $layer"
    echo "Fetched: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "---"
    echo "$content"
  } > "$cache_file"

  local content_len=${#content}
  echo "{\"ts\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"url\":\"$url\",\"layer\":\"$layer\",\"len\":$content_len,\"file\":\"${short_hash}.txt\"}" \
    >> "$WEB_CACHE_DIR/manifest.jsonl" 2>/dev/null
}

# Cleanup: remove cache files older than 7 days (fire-and-forget)
find "$WEB_CACHE_DIR" -name '*.txt' -mtime +7 -delete 2>/dev/null &

# ─── Content Quality Gate ─────────────────────────────────────────────────────
is_content_useful() {
  local content="$1" url="$2"
  local content_len=${#content}

  local restrict_count
  restrict_count=$(echo "$content" | head -30 | grep -ciE '目前無法查看此內容|此內容目前無法顯示|this content isn.t available|sorry.*this page isn.t available|content.unavailable|you must log in to continue|受限制的內容' || true)
  [[ "$restrict_count" -ge 1 ]] && return 1

  local cf_count
  cf_count=$(echo "$content" | head -50 | grep -ciE 'cf-browser-verification|challenge-platform|just a moment|checking your browser|enable javascript and cookies|please wait while we verify' || true)
  [[ "$cf_count" -ge 2 ]] && return 1

  local bot_count
  bot_count=$(echo "$content" | head -50 | grep -ciE 'bot detected|automated access|please verify you are human|unusual traffic' || true)
  [[ "$bot_count" -ge 1 ]] && return 1

  if echo "$url" | grep -qiE 'facebook\.com|instagram\.com|threads\.net|x\.com|twitter\.com'; then
    [[ "$content_len" -lt 500 ]] && return 1
  fi

  return 0
}

# ─── Adaptive Domain Router ──────────────────────────────────────────────────
# Learn from past fetches: which layer worked best for each domain?
get_preferred_layer() {
  local domain="$1"
  local manifest="$WEB_CACHE_DIR/manifest.jsonl"
  [[ -f "$manifest" ]] || return

  # Find most recent successful fetch for this domain
  local match
  match=$(grep -F "$domain" "$manifest" 2>/dev/null | tail -1)
  [[ -z "$match" ]] && return

  local layer
  layer=$(echo "$match" | jq -r '.layer // empty' 2>/dev/null)
  # Normalize legacy layer names
  [[ "$layer" == "http" ]] && layer="curl"
  echo "$layer"
}

# Check if Chrome CDP is available (port 9222)
CDP_AVAILABLE=false
if curl -s --max-time 2 "http://localhost:${CDP_PORT:-9222}/json/version" > /dev/null 2>&1; then
  CDP_AVAILABLE=true
fi

# ─── Layer Functions ─────────────────────────────────────────────────────────
# Each returns 0 on success (sets _OUT, _TITLE), 1 on failure.
# On success, also calls cache_content.

_OUT=""
_TITLE=""

try_curl() {
  local url="$1"
  _OUT="" ; _TITLE=""

  local content
  content=$(curl -sL --max-time 8 --max-filesize 1048576 \
    -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" \
    -H "Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8" \
    -H "Accept-Language: en-US,en;q=0.9" \
    -H "Accept-Encoding: gzip, deflate, br" \
    -H "Sec-CH-UA: \"Google Chrome\";v=\"131\", \"Chromium\";v=\"131\", \"Not_A Brand\";v=\"24\"" \
    -H "Sec-CH-UA-Mobile: ?0" \
    -H "Sec-CH-UA-Platform: \"macOS\"" \
    -H "Sec-Fetch-Dest: document" \
    -H "Sec-Fetch-Mode: navigate" \
    -H "Sec-Fetch-Site: none" \
    -H "Sec-Fetch-User: ?1" \
    -H "Upgrade-Insecure-Requests: 1" \
    -H "DNT: 1" \
    --compressed \
    "$url" 2>/dev/null)

  [[ $? -ne 0 || -z "$content" ]] && return 1

  local is_auth
  is_auth=$(echo "$content" | head -100 | grep -ciE 'sign.in|log.in|login|password|captcha|verify|驗證|登入|403|forbidden|unauthorized' || true)
  local content_len=${#content}

  [[ "$is_auth" -ge 2 || "$content_len" -le 200 ]] && return 1
  is_content_useful "$content" "$url" || return 1

  if echo "$content" | head -5 | grep -qi '<html\|<!doctype'; then
    # Three-layer content extraction:
    #   Layer 1a: Readability + Turndown markdown (best quality)
    #   Layer 1b: Trafilatura (Python, better boilerplate removal for some sites)
    #   Layer 1c: sed fallback (last resort)
    local extracted full_text extracted_words

    # Layer 1a: Readability → Markdown
    extracted=$(echo "$content" | node "$SCRIPT_DIR/scripts/extract-content.mjs" --url "$url" 2>/dev/null)
    extracted_words=$(echo "$extracted" | tail -n +2 | wc -w | tr -d ' ')

    if [[ -n "$extracted" && "$extracted_words" -gt 50 ]]; then
      _TITLE=$(echo "$extracted" | head -1)
      full_text=$(echo "$extracted" | tail -n +2)
      cache_content "$url" "curl+readability" "$full_text" "$_TITLE"
      _OUT="${full_text:0:1000}"

    # Layer 1b: Trafilatura fallback
    elif command -v uv &>/dev/null && [[ -f "$SCRIPT_DIR/scripts/extract-content-py.py" ]]; then
      extracted=$(echo "$content" | uv run --quiet "$SCRIPT_DIR/scripts/extract-content-py.py" "$url" 2>/dev/null)
      extracted_words=$(echo "$extracted" | tail -n +2 | wc -w | tr -d ' ')
      if [[ -n "$extracted" && "$extracted_words" -gt 30 ]]; then
        _TITLE=$(echo "$extracted" | head -1)
        full_text=$(echo "$extracted" | tail -n +2)
        cache_content "$url" "curl+trafilatura" "$full_text" "$_TITLE"
        _OUT="${full_text:0:1000}"
      fi
    fi

    # Layer 1c: sed fallback (if both extractors failed)
    if [[ -z "$_OUT" ]]; then
      _TITLE=$(echo "$content" | grep -oi '<title[^>]*>[^<]*</title>' | sed 's/<[^>]*>//g' | head -1)
      full_text=$(echo "$content" \
        | sed 's/<script[^>]*>.*<\/script>//gi' \
        | sed 's/<style[^>]*>.*<\/style>//gi' \
        | sed 's/<[^>]*>//g' \
        | tr -s '[:space:]' ' ')
      cache_content "$url" "curl+sed" "$full_text" "$_TITLE"
      _OUT="${full_text:0:1000}"
    fi
  else
    cache_content "$url" "curl" "$content"
    _OUT="${content:0:1000}"
  fi
  return 0
}

try_jina() {
  local url="$1"
  _OUT="" ; _TITLE=""

  local result
  result=$(curl -sL --max-time 15 \
    -H "Accept: text/markdown" \
    "https://r.jina.ai/$url" 2>/dev/null)

  [[ $? -ne 0 || ${#result} -le 200 ]] && return 1
  is_content_useful "$result" "$url" || return 1

  local auth_count
  auth_count=$(echo "$result" | head -20 | grep -ciE 'sign.in|log.in|login|password|captcha|403|forbidden|unauthorized' || true)
  [[ "$auth_count" -ge 2 ]] && return 1

  cache_content "$url" "jina" "$result"
  _OUT=$(echo "$result" | head -30)
  return 0
}

try_stealth() {
  local url="$1"
  _OUT="" ; _TITLE=""

  command -v uv &>/dev/null || return 1
  [[ -f "$STEALTH_FETCH" ]] || return 1

  local json_result
  json_result=$(uv run --quiet "$STEALTH_FETCH" "$url" --json 2>/dev/null)
  [[ $? -ne 0 || -z "$json_result" ]] && return 1

  local content title content_len
  content=$(echo "$json_result" | jq -r '.content // empty' 2>/dev/null)
  title=$(echo "$json_result" | jq -r '.title // empty' 2>/dev/null)
  content_len=${#content}

  [[ "$content_len" -le 200 ]] && return 1
  is_content_useful "$content" "$url" || return 1

  cache_content "$url" "stealth" "$content" "$title"
  _TITLE="$title"
  _OUT="${content:0:1000}"
  return 0
}

try_grok() {
  local url="$1"
  _OUT="" ; _TITLE=""

  # Grok only works for X/Twitter URLs
  echo "$url" | grep -qiE 'x\.com|twitter\.com' || return 1
  [[ -n "${XAI_API_KEY:-}" ]] || return 1

  local response
  response=$(curl -s --connect-timeout 5 --max-time 15 "https://api.x.ai/v1/responses" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $XAI_API_KEY" \
    -d "{
      \"model\": \"grok-4-1-fast\",
      \"tools\": [{\"type\": \"x_search\"}],
      \"instructions\": \"Read this tweet/post and return its full content: author, text, engagement stats. Plain text, no markdown.\",
      \"input\": \"$url\"
    }" 2>/dev/null)

  local text
  text=$(echo "$response" | jq -r '
    [.output[]? | select(.type == "message") | .content[]? | select(.type == "output_text") | .text] | first // empty
  ' 2>/dev/null)

  [[ -z "$text" || ${#text} -le 50 ]] && return 1

  cache_content "$url" "grok" "$text"
  _OUT=$(echo "$text" | head -25)
  return 0
}

try_cdp() {
  local url="$1"
  _OUT="" ; _TITLE=""

  [[ "$CDP_AVAILABLE" == "true" ]] || return 1
  [[ -f "$CDP_FETCH" ]] || return 1

  local result
  result=$(node "$CDP_FETCH" fetch "$url" 2>/dev/null)
  [[ $? -ne 0 || -z "$result" ]] && return 1

  if echo "$result" | head -1 | grep -q "AUTH_REQUIRED"; then
    _OUT="Login required\nTo access: node scripts/cdp-fetch.mjs open \"$url\""
    return 0  # "success" in that we got a definitive answer
  fi

  is_content_useful "$result" "$url" || return 1

  cache_content "$url" "cdp" "$result"
  _OUT=$(echo "$result" | sed '/^--- Links ---$/,$d' | head -30)
  return 0
}

try_vlm() {
  local url="$1"
  _OUT="" ; _TITLE=""

  [[ "$CDP_AVAILABLE" == "true" ]] || return 1
  [[ -f "$SCRIPT_DIR/scripts/vlm-extract.sh" ]] || return 1

  local result
  result=$(bash "$SCRIPT_DIR/scripts/vlm-extract.sh" "$url" 2>/dev/null)
  [[ $? -ne 0 || -z "$result" || ${#result} -lt 50 ]] && return 1

  _TITLE=$(echo "$result" | head -1 | sed 's/^#\+ //')
  local full_text
  full_text=$(echo "$result")
  cache_content "$url" "vlm" "$full_text" "$_TITLE"
  _OUT="${full_text:0:1000}"
  return 0
}

# ─── Nutrient Router Integration ────────────────────────────────────────────
# Slime mold model: check domain nutrient score before fetching
NUTRIENT_CLI="$SCRIPT_DIR/scripts/nutrient-cli.mjs"

nutrient_route() {
  local domain="$1"
  # Fail-open: if CLI unavailable, always fetch
  [[ -f "$NUTRIENT_CLI" ]] || echo '{"action":"fetch","score":50}'
  node "$NUTRIENT_CLI" route "$domain" 2>/dev/null || echo '{"action":"fetch","score":50}'
}

nutrient_log_fetch() {
  local domain="$1" url="$2" method="$3" content_len="$4" extracted_len="$5" success="$6"
  [[ -f "$NUTRIENT_CLI" ]] || return 0
  node "$NUTRIENT_CLI" log-fetch "$domain" "$url" "$method" "$content_len" "$extracted_len" "$success" 2>/dev/null &
}

# ─── Fetch Orchestrator ──────────────────────────────────────────────────────
# Tries preferred layer first (from domain history), then cascades through all.
# Logs each fetch outcome to nutrient tracker for slime mold scoring.
_FETCH_METHOD=""

fetch_url() {
  local url="$1" domain="$2"
  _OUT="" ; _TITLE="" ; _FETCH_METHOD=""

  # Adaptive routing: check domain history
  local preferred
  preferred=$(get_preferred_layer "$domain")

  # Default cascade order (vlm = Layer 2 visual fallback, last resort)
  local layers="curl jina stealth grok cdp vlm"

  if [[ -n "$preferred" ]]; then
    # Try preferred first
    if "try_$preferred" "$url" 2>/dev/null; then
      _FETCH_METHOD="$preferred"
      return 0
    fi
    # Preferred failed — remove it from cascade to avoid double-trying
    layers=$(echo "$layers" | sed "s/$preferred//")
  fi

  # Normal cascade
  for layer in $layers; do
    if "try_$layer" "$url" 2>/dev/null; then
      _FETCH_METHOD="$layer"
      return 0
    fi
  done

  return 1
}

# ─── Main Loop ───────────────────────────────────────────────────────────────

SKIP_COUNT=0
FETCH_COUNT=0

for URL in $URLS; do
  DOMAIN=$(echo "$URL" | sed -E 's|https?://([^/]+).*|\1|' | sed 's/^www\.//')

  # Skip if recently cached (< 10 min)
  url_hash=$(echo -n "$URL" | md5 -q 2>/dev/null || echo -n "$URL" | md5sum 2>/dev/null | cut -d' ' -f1)
  cache_file="$WEB_CACHE_DIR/${url_hash:0:12}.txt"
  if [[ -f "$cache_file" ]]; then
    cache_age=$(( $(date +%s) - $(stat -f%m "$cache_file" 2>/dev/null || stat -c%Y "$cache_file" 2>/dev/null || echo 0) ))
    if [[ "$cache_age" -lt 600 ]]; then
      echo "[$DOMAIN] (cached ${cache_age}s ago)"
      awk '/^---$/{found=1; next} found{print; count++; if(count>=30) exit}' "$cache_file"
      echo ""
      continue
    fi
  fi

  # Nutrient routing: check domain score before fetching
  route_json=$(nutrient_route "$DOMAIN")
  route_action=$(echo "$route_json" | jq -r '.action // "fetch"' 2>/dev/null || echo "fetch")
  route_score=$(echo "$route_json" | jq -r '.score // 50' 2>/dev/null || echo "50")
  route_reason=$(echo "$route_json" | jq -r '.reason // ""' 2>/dev/null || echo "")

  if [[ "$route_action" == "skip" ]]; then
    echo "[$DOMAIN] ✂ pruned (score:${route_score} — ${route_reason})"
    SKIP_COUNT=$((SKIP_COUNT + 1))
    echo ""
    continue
  fi

  [[ "$route_action" == "explore" ]] && echo "[$DOMAIN] 🔍 exploring (score:${route_score})" || echo "[$DOMAIN] ★ reinforced (score:${route_score})"

  if fetch_url "$URL" "$DOMAIN"; then
    FETCH_COUNT=$((FETCH_COUNT + 1))
    [[ -n "$_TITLE" ]] && echo "$_TITLE"
    [[ -n "$_OUT" ]] && echo -e "$_OUT"
    # Log successful fetch to nutrient tracker
    nutrient_log_fetch "$DOMAIN" "$URL" "${_FETCH_METHOD:-unknown}" "${#_OUT}" "${#_OUT}" "true"
  else
    echo "Cannot fetch — requires login or is inaccessible"
    # Log failed fetch
    nutrient_log_fetch "$DOMAIN" "$URL" "none" "0" "0" "false"
    if echo "$URL" | grep -qiE 'x\.com|twitter\.com' && [[ -z "${XAI_API_KEY:-}" ]]; then
      echo "Tip: Set XAI_API_KEY for X/Twitter"
    fi
  fi
  echo ""
done

# Summary line for observability
[[ $SKIP_COUNT -gt 0 ]] && echo "Nutrient routing: ${FETCH_COUNT} fetched, ${SKIP_COUNT} pruned"
