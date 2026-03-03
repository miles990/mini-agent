#!/bin/bash
# search-web.sh — SearXNG structured web search
# Usage: bash scripts/search-web.sh "query" [--limit N] [--lang LANG] [--engines ENGINE1,ENGINE2]
#
# Examples:
#   bash scripts/search-web.sh "perception-driven AI agent"
#   bash scripts/search-web.sh "Oulipo constraint literature" --limit 5
#   bash scripts/search-web.sh "最新 AI 論文" --lang zh
#   bash scripts/search-web.sh "site:github.com mini-agent" --engines google,duckduckgo

set -euo pipefail

SEARXNG_URL="${SEARXNG_URL:-http://localhost:8888}"
DEFAULT_LIMIT=10
DEFAULT_LANG="all"

# Parse arguments
QUERY=""
LIMIT="$DEFAULT_LIMIT"
LANG="$DEFAULT_LANG"
ENGINES=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --limit) LIMIT="$2"; shift 2 ;;
    --lang) LANG="$2"; shift 2 ;;
    --engines) ENGINES="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: search-web.sh \"query\" [--limit N] [--lang LANG] [--engines E1,E2]"
      echo ""
      echo "Options:"
      echo "  --limit N        Max results (default: 10)"
      echo "  --lang LANG      Language filter (default: all)"
      echo "  --engines E1,E2  Specific engines (default: all)"
      echo ""
      echo "Output: One result per block — title, URL, snippet"
      exit 0
      ;;
    *) QUERY="$1"; shift ;;
  esac
done

if [[ -z "$QUERY" ]]; then
  echo "Error: No query provided" >&2
  echo "Usage: search-web.sh \"query\" [--limit N]" >&2
  exit 1
fi

# Check SearXNG availability
if ! curl -sf --max-time 3 "$SEARXNG_URL/healthz" >/dev/null 2>&1 && \
   ! curl -sf --max-time 3 "$SEARXNG_URL/" >/dev/null 2>&1; then
  echo "Error: SearXNG not reachable at $SEARXNG_URL" >&2
  echo "Start it: cd docker && docker compose up -d" >&2
  exit 1
fi

# Build query URL
PARAMS="q=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$QUERY'))")&format=json&language=$LANG"
if [[ -n "$ENGINES" ]]; then
  PARAMS="$PARAMS&engines=$ENGINES"
fi

# Execute search
RESPONSE=$(curl -sf --max-time 15 "$SEARXNG_URL/search?$PARAMS" 2>/dev/null)

if [[ -z "$RESPONSE" ]]; then
  echo "Error: Empty response from SearXNG" >&2
  exit 1
fi

# Format results
RESULT_COUNT=$(echo "$RESPONSE" | jq '.results | length')

if [[ "$RESULT_COUNT" -eq 0 ]]; then
  echo "No results found for: $QUERY"
  exit 0
fi

# Output header
echo "=== Search: $QUERY ==="
echo "Results: $RESULT_COUNT (showing top $LIMIT)"
echo ""

# Output results
echo "$RESPONSE" | jq -r --argjson limit "$LIMIT" '
  .results[:$limit] | to_entries[] |
  "[\(.key + 1)] \(.value.title)\n    \(.value.url)\n    \(.value.content // "—")\n"
'
