#!/bin/bash
# X/Twitter Feed Perception — Grok API X Search (Phase 2)
# stdout gets wrapped in <x-feed>...</x-feed> and injected into Agent context
# Heartbeat interval (30min)
#
# Strategy: Use Grok API's /v1/responses with x_search tool to find
# relevant X posts. No CDP dependency — works even when Chrome is closed.

XAI_API_KEY="${XAI_API_KEY:-}"
CACHE_DIR="$HOME/.mini-agent"
CACHE_FILE="$CACHE_DIR/x-feed-cache.txt"
CACHE_TTL=1500  # 25min
STALE_TTL=7200  # 2h — fallback to stale cache if API fails

# Need API key
if [[ -z "$XAI_API_KEY" ]]; then
  echo "XAI_API_KEY not set"
  exit 0
fi

# Return cache if fresh enough
if [[ -f "$CACHE_FILE" ]]; then
  CACHE_AGE=$(( $(date +%s) - $(stat -f %m "$CACHE_FILE" 2>/dev/null || echo 0) ))
  if [[ $CACHE_AGE -lt $CACHE_TTL ]]; then
    cat "$CACHE_FILE"
    exit 0
  fi
fi

# Query Grok API with x_search tool
# Note: only grok-4 family supports x_search (grok-3-mini deprecated for tools)
# Keep query simple and timeout tight — Grok x_search can be slow
RESPONSE=$(curl -s --connect-timeout 5 --max-time 20 "https://api.x.ai/v1/responses" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -d '{
    "model": "grok-4-1-fast",
    "tools": [{"type": "x_search"}],
    "instructions": "List top 5 trending posts. For each: @handle, one-line summary, likes. Plain text, no markdown.",
    "input": "trending AI agent posts today"
  }' 2>/dev/null)

# Helper: fallback to stale cache (< 2h old) on API failure
fallback_stale() {
  if [[ -f "$CACHE_FILE" ]]; then
    CACHE_AGE=$(( $(date +%s) - $(stat -f %m "$CACHE_FILE" 2>/dev/null || echo 0) ))
    if [[ $CACHE_AGE -lt $STALE_TTL ]]; then
      cat "$CACHE_FILE"
      exit 0
    fi
  fi
  echo "$1"
  exit 0
}

# Check for empty response (timeout) or API error
if [[ -z "$RESPONSE" ]]; then
  fallback_stale "Grok API: request timeout"
fi

# Check for API error (jq single pass — eliminates 2x python3 startup ~130ms)
HAS_ERROR=$(echo "$RESPONSE" | jq -r '.error.message // .code // empty' 2>/dev/null)
if [[ -n "$HAS_ERROR" ]]; then
  fallback_stale "Grok API error: $HAS_ERROR"
fi

# Extract text output (jq single pass)
OUTPUT=$(echo "$RESPONSE" | jq -r '
  [.output[]? | select(.type == "message") | .content[]? | select(.type == "output_text") | .text] | first // empty
' 2>/dev/null)

if [[ -z "$OUTPUT" ]]; then
  fallback_stale "Grok X Search returned no results"
fi

# Format with timestamp
FINAL="X Feed via Grok ($(date '+%H:%M')):
$OUTPUT"

# Write cache and output
echo "$FINAL" | tee "$CACHE_FILE"
