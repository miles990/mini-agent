#!/bin/bash
# Pinchtab Vision — Screenshot + OCR/Vision analysis
#
# Usage:
#   bash scripts/pinchtab-vision.sh [url] [--ocr|--vision]
#   bash scripts/pinchtab-vision.sh --ocr                    # Current page OCR
#   bash scripts/pinchtab-vision.sh https://example.com --ocr # Navigate + OCR

PINCHTAB_PORT="${PINCHTAB_PORT:-9867}"
SHOT="/tmp/pinchtab-vision-$$.jpg"

# Parse args
URL=""
MODE="vision"
for arg in "$@"; do
  case "$arg" in
    --ocr) MODE="ocr" ;;
    --vision) MODE="vision" ;;
    http*) URL="$arg" ;;
  esac
done

# Check Pinchtab
if ! curl -sf --max-time 3 "http://localhost:${PINCHTAB_PORT}/health" >/dev/null 2>&1; then
  echo "Pinchtab not available. Run: bash scripts/pinchtab-setup.sh start" >&2
  exit 1
fi

# Navigate if URL given
if [[ -n "$URL" ]]; then
  curl -sf -X POST "http://localhost:$PINCHTAB_PORT/navigate" \
    -H "Content-Type: application/json" \
    -d "{\"url\":\"$URL\"}" >/dev/null 2>&1
  sleep 2
fi

# Capture screenshot
curl -sf --max-time 15 "http://localhost:$PINCHTAB_PORT/screenshot" -o "$SHOT" 2>/dev/null

if [[ ! -f "$SHOT" ]] || [[ ! -s "$SHOT" ]]; then
  echo "Screenshot failed" >&2
  exit 1
fi

# Analyze
if [[ "$MODE" == "ocr" ]]; then
  # Apple Vision OCR (free, local, fast)
  if python3 -c "import ocrmac" 2>/dev/null; then
    python3 -c "
import ocrmac
results = ocrmac.ocr('$SHOT')
for r in results:
    print(r[0])
" 2>/dev/null
  else
    echo "ocrmac not installed. Install: pip install ocrmac" >&2
    echo "Falling back to screenshot path..."
    echo "Screenshot saved: $SHOT"
    exit 0
  fi
else
  # Claude Vision — screenshot saved for OODA cycle analysis
  echo "Screenshot saved: $SHOT"
  echo "Use Claude Vision for analysis"
fi

rm -f "$SHOT" 2>/dev/null
