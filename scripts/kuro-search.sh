#!/bin/bash
# Kuro Search — SearXNG wrapper for programmatic search
# Usage: bash scripts/kuro-search.sh "query" [max_results]

QUERY="${1:?Usage: kuro-search.sh \"query\" [max_results]}"
MAX=${2:-10}
SEARXNG_URL="http://localhost:8888"

# Check SearXNG availability
if ! curl -sf "$SEARXNG_URL/healthz" -o /dev/null 2>/dev/null; then
  echo "ERROR: SearXNG not available at $SEARXNG_URL"
  echo "Start with: cd docker && docker compose up -d"
  exit 1
fi

# URL encode query
ENCODED=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$QUERY'))")

# Search and format
curl -sf "$SEARXNG_URL/search?q=$ENCODED&format=json" 2>/dev/null | \
  python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    results = d.get('results', [])[:$MAX]
    for i, r in enumerate(results, 1):
        title = r.get('title', 'No title')[:80]
        url = r.get('url', '')
        content = r.get('content', '')[:120]
        print(f'{i}. {title}')
        print(f'   {url}')
        if content:
            print(f'   {content}')
        print()
    print(f'Total: {len(d.get(\"results\", []))} results (showing {len(results)})')
except Exception as e:
    print(f'Parse error: {e}', file=sys.stderr)
    sys.exit(1)
"
