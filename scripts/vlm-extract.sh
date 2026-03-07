#!/bin/bash
# VLM Visual Extraction — Layer 2
# Takes a screenshot of a URL and uses Claude Vision to extract text content.
# Used when text-based extraction (Layer 1) fails or produces poor results.
#
# Usage:
#   bash scripts/vlm-extract.sh <url>
#   bash scripts/vlm-extract.sh <url> --json
#
# Requires: cdp-fetch.mjs (Chrome CDP), ANTHROPIC_API_KEY or claude CLI
# Output: Line 1 = title (if detected), Line 2+ = extracted markdown content

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CDP_FETCH="$SCRIPT_DIR/scripts/cdp-fetch.mjs"
TMPDIR="${TMPDIR:-/tmp}"
SCREENSHOT="$TMPDIR/vlm-extract-$$.png"

URL="${1:-}"
JSON_MODE=false
[[ "${2:-}" == "--json" ]] && JSON_MODE=true

if [[ -z "$URL" ]]; then
  echo "Usage: vlm-extract.sh <url> [--json]" >&2
  exit 1
fi

cleanup() { rm -f "$SCREENSHOT"; }
trap cleanup EXIT

# ─── Step 1: Screenshot via CDP ────────────────────────────────────────────────

# Check CDP availability
if ! curl -s --max-time 2 "http://localhost:${CDP_PORT:-9222}/json/version" > /dev/null 2>&1; then
  echo "CDP not available" >&2
  exit 1
fi

if [[ ! -f "$CDP_FETCH" ]]; then
  echo "cdp-fetch.mjs not found" >&2
  exit 1
fi

# Take screenshot
node "$CDP_FETCH" screenshot "$URL" "$SCREENSHOT" 2>/dev/null
if [[ ! -f "$SCREENSHOT" || ! -s "$SCREENSHOT" ]]; then
  echo "Screenshot failed" >&2
  exit 1
fi

# ─── Step 2: Send to Vision model ─────────────────────────────────────────────

PROMPT="Extract ALL text content from this webpage screenshot. Output as clean markdown. Include headings, paragraphs, lists, code blocks as they appear. Skip navigation menus, footers, and ads. First line should be the page title if visible."

# Base64 encode the screenshot
IMG_BASE64=$(base64 < "$SCREENSHOT" | tr -d '\n')

extract_via_api() {
  local api_key="${ANTHROPIC_API_KEY:-}"
  [[ -z "$api_key" ]] && return 1

  local response
  response=$(curl -s --max-time 30 "https://api.anthropic.com/v1/messages" \
    -H "x-api-key: $api_key" \
    -H "content-type: application/json" \
    -H "anthropic-version: 2023-06-01" \
    -d "{
      \"model\": \"claude-haiku-4-5-20251001\",
      \"max_tokens\": 4096,
      \"messages\": [{
        \"role\": \"user\",
        \"content\": [
          {\"type\": \"image\", \"source\": {\"type\": \"base64\", \"media_type\": \"image/png\", \"data\": \"$IMG_BASE64\"}},
          {\"type\": \"text\", \"text\": \"$PROMPT\"}
        ]
      }]
    }" 2>/dev/null)

  local text
  text=$(echo "$response" | jq -r '.content[0].text // empty' 2>/dev/null)
  [[ -z "$text" ]] && return 1
  echo "$text"
}

extract_via_cli() {
  # Use claude CLI as fallback (works in launchd env without API key)
  command -v claude &>/dev/null || return 1

  # claude CLI with image support
  claude -p "$PROMPT" \
    --model claude-haiku-4-5-20251001 \
    --no-input \
    --max-turns 1 \
    --image "$SCREENSHOT" 2>/dev/null
}

# Try API first (cheaper), then CLI
RESULT=""
RESULT=$(extract_via_api 2>/dev/null) || RESULT=$(extract_via_cli 2>/dev/null) || true

if [[ -z "$RESULT" || ${#RESULT} -lt 50 ]]; then
  echo "VLM extraction failed" >&2
  exit 1
fi

# ─── Step 3: Output ───────────────────────────────────────────────────────────

if $JSON_MODE; then
  # Extract first line as title
  TITLE=$(echo "$RESULT" | head -1 | sed 's/^#\+ //')
  CONTENT=$(echo "$RESULT" | tail -n +2)
  jq -n --arg title "$TITLE" --arg content "$CONTENT" \
    '{title: $title, content: $content, method: "vlm", length: ($content | length)}'
else
  echo "$RESULT"
fi
