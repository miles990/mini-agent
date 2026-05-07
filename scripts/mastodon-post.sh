#!/bin/bash
# Mastodon posting helper for Kuro-owned Mastodon identity
# Usage: ./mastodon-post.sh "Your post text here"
# Or: echo "text" | ./mastodon-post.sh

set -euo pipefail

INSTANCE="${MASTODON_INSTANCE:-https://mastodon.social}"
EXPECTED_HANDLE="${KURO_MASTODON_HANDLE:-${MASTODON_HANDLE:-kuro_agent@mastodon.social}}"
CREDS_FILE="${MASTODON_CREDS_FILE:-$HOME/.mini-agent/instances/03bbc29a/mastodon-credentials.json}"

if [ ! -f "$CREDS_FILE" ]; then
  echo "Error: Credentials not found at $CREDS_FILE" >&2
  exit 1
fi

TOKEN=$(python3 -c "import json; print(json.load(open('$CREDS_FILE'))['primary']['access_token'])")

ACTUAL_HANDLE=$(curl -sf "$INSTANCE/api/v1/accounts/verify_credentials" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import json, sys
d = json.load(sys.stdin)
acct = d.get('acct') or ''
print(acct if '@' in acct else acct + '@' + '$INSTANCE'.replace('https://', '').replace('http://', ''))
" 2>/dev/null || true)
if [ "$ACTUAL_HANDLE" != "$EXPECTED_HANDLE" ]; then
  echo "Error: Mastodon identity mismatch: expected $EXPECTED_HANDLE, got ${ACTUAL_HANDLE:-unknown}" >&2
  echo "Refusing outbound write. Update config/agent-capabilities.json or the Mastodon credential env." >&2
  exit 1
fi

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
  -d "$(TEXT="$TEXT" python3 -c "import json, os; print(json.dumps({'status': os.environ['TEXT']}))")" 2>&1) || {
  echo "Error posting: $RESPONSE" >&2
  exit 1
}

URL=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin).get('url',''))" 2>/dev/null)
echo "Posted: $URL"
