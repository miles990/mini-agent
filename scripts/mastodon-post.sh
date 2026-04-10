#!/bin/bash
# Mastodon posting helper for kuro_agent@mastodon.social
# Usage: ./mastodon-post.sh "Your post text here"
# Or: echo "text" | ./mastodon-post.sh

set -euo pipefail

INSTANCE="https://mastodon.social"
CREDS_FILE="$HOME/.mini-agent/instances/03bbc29a/mastodon-credentials.json"

if [ ! -f "$CREDS_FILE" ]; then
  echo "Error: Credentials not found at $CREDS_FILE" >&2
  exit 1
fi

TOKEN=$(python3 -c "import json; print(json.load(open('$CREDS_FILE'))['primary']['access_token'])")

# Get text from argument or stdin
if [ $# -gt 0 ]; then
  TEXT="$1"
else
  TEXT=$(cat)
fi

if [ -z "$TEXT" ]; then
  echo "Error: No post text provided" >&2
  echo "Usage: $0 \"Your post text\"" >&2
  exit 1
fi

# Post
RESPONSE=$(curl -sf -X POST "$INSTANCE/api/v1/statuses" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$(python3 -c "import json; print(json.dumps({'status': '''$TEXT'''}))")" 2>&1) || {
  echo "Error posting: $RESPONSE" >&2
  exit 1
}

URL=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('url',''))" 2>/dev/null)
echo "Posted: $URL"
