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
# Keep query simple to avoid timeout (complex multi-part queries timeout at 30-45s)
RESPONSE=$(curl -s --max-time 60 "https://api.x.ai/v1/responses" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -d '{
    "model": "grok-4-1-fast",
    "tools": [{"type": "x_search"}],
    "instructions": "List top 5 interesting posts. For each: @handle, one-line summary, likes count. Plain text, no markdown.",
    "input": "trending AI agent and personal AI posts today"
  }' 2>/dev/null)

# Check for empty response (timeout) or API error
if [[ -z "$RESPONSE" ]]; then
  echo "Grok API: request timeout"
  exit 0
fi

# Check for API error in response
HAS_ERROR=$(echo "$RESPONSE" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    if 'error' in d:
        print(d['error'].get('message', 'unknown error'))
    elif 'code' in d:
        print(d.get('error', d.get('code', 'unknown')))
except:
    pass
" 2>/dev/null)

if [[ -n "$HAS_ERROR" ]]; then
  echo "Grok API error: $HAS_ERROR"
  exit 0
fi

# Extract the text output from the response
OUTPUT=$(echo "$RESPONSE" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    output = data.get('output', [])
    for item in output:
        if item.get('type') == 'message':
            content = item.get('content', [])
            for c in content:
                if c.get('type') == 'output_text':
                    print(c['text'])
                    sys.exit(0)
    print('No text output found')
except Exception as e:
    print(f'Parse error: {e}')
" 2>/dev/null)

if [[ -z "$OUTPUT" ]] || [[ "$OUTPUT" == "No text output found" ]] || [[ "$OUTPUT" == Parse* ]]; then
  echo "Grok X Search returned no results"
  exit 0
fi

# Format with timestamp
FINAL="X Feed via Grok ($(date '+%H:%M')):
$OUTPUT"

# Write cache and output
echo "$FINAL" | tee "$CACHE_FILE"
