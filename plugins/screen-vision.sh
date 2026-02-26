#!/bin/bash
# Screen Vision — 定期截取當前頁面 OCR
# Category: chrome (120s interval)
# stdout 會被包在 <screen-text>...</screen-text> 中注入 Agent context
#
# 只在 Chrome CDP 可用且 ocrmac 已安裝時執行
# Hash-based 變更偵測：只在畫面改變時重新 OCR

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CDP_FETCH="$PROJECT_DIR/scripts/cdp-fetch.mjs"
CACHE_DIR="$HOME/.mini-agent"
SHOT_FILE="$CACHE_DIR/screen-vision.png"
TEXT_CACHE="$CACHE_DIR/screen-vision-text.txt"
HASH_CACHE="$CACHE_DIR/screen-vision-hash.txt"

# Check Chrome CDP
if ! node "$CDP_FETCH" status &>/dev/null; then
  exit 0
fi

# Check ocrmac
if ! python3 -c "import ocrmac" 2>/dev/null; then
  exit 0
fi

mkdir -p "$CACHE_DIR"

# Capture screenshot via cdp-fetch.mjs (screenshots current active tab)
node "$CDP_FETCH" screenshot "" "$SHOT_FILE" 2>/dev/null
if [[ ! -f "$SHOT_FILE" ]] || [[ ! -s "$SHOT_FILE" ]]; then
  exit 0
fi

# Hash-based change detection
NEW_HASH=$(md5 -q "$SHOT_FILE" 2>/dev/null || md5sum "$SHOT_FILE" 2>/dev/null | cut -d' ' -f1)
OLD_HASH=""
[[ -f "$HASH_CACHE" ]] && OLD_HASH=$(cat "$HASH_CACHE")

if [[ "$NEW_HASH" == "$OLD_HASH" ]] && [[ -f "$TEXT_CACHE" ]]; then
  # No change — return cached text
  cat "$TEXT_CACHE"
  exit 0
fi

# OCR
OCR_TEXT=$(python3 -c "
import ocrmac
results = ocrmac.ocr('$SHOT_FILE')
for r in results:
    print(r[0])
" 2>/dev/null)

if [[ -z "$OCR_TEXT" ]]; then
  exit 0
fi

# Update caches
echo "$NEW_HASH" > "$HASH_CACHE"
echo "$OCR_TEXT" > "$TEXT_CACHE"

# Output (truncated)
echo "Screen OCR ($(date '+%H:%M')):"
echo "$OCR_TEXT" | head -c 2000

rm -f "$SHOT_FILE" 2>/dev/null
