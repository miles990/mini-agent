#!/bin/bash
# LINE Group Digest Perception — Claude MAX 俱樂部動態感知
# stdout gets wrapped in <line-group>...</line-group> and injected into Agent context
# Heartbeat interval (30min)
#
# Fetches group-digest (Supabase SPA) via cdp-fetch, extracts recent discussions.
# This gives Kuro visibility into what the LINE community is discussing.

SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CACHE_DIR="$HOME/.mini-agent"
CACHE_FILE="$CACHE_DIR/line-digest-cache.txt"
CACHE_TTL=1800   # 30min
STALE_TTL=7200   # 2h fallback

DIGEST_URL="https://atm301.github.io/group-digest/"

# Return cache if fresh enough
if [[ -f "$CACHE_FILE" ]]; then
  CACHE_AGE=$(( $(date +%s) - $(stat -f %m "$CACHE_FILE" 2>/dev/null || echo 0) ))
  if [[ $CACHE_AGE -lt $CACHE_TTL ]]; then
    cat "$CACHE_FILE"
    exit 0
  fi
fi

# Fallback helper — use stale cache if available
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

# Try cdp-fetch (requires Chrome with CDP on port 9222)
CDP_FETCH="$SCRIPT_DIR/scripts/cdp-fetch.mjs"
if [[ ! -f "$CDP_FETCH" ]]; then
  fallback_stale "cdp-fetch not found"
fi

# Step 1: Fetch list page to find latest issue number
LIST_RAW=$(node "$CDP_FETCH" fetch "$DIGEST_URL" --compact 2>/dev/null)
if [[ -z "$LIST_RAW" || ${#LIST_RAW} -lt 100 ]]; then
  fallback_stale "fetch failed or empty"
fi

# Extract latest issue number (first #N pattern in content)
LATEST_ISSUE=$(echo "$LIST_RAW" | grep -oE '#[0-9]+' | head -1 | tr -d '#')
if [[ -z "$LATEST_ISSUE" ]]; then
  LATEST_ISSUE="2"  # fallback
fi

# Step 2: Fetch latest issue content
ISSUE_RAW=$(node "$CDP_FETCH" fetch "${DIGEST_URL}#issue-${LATEST_ISSUE}" --compact 2>/dev/null)
if [[ -z "$ISSUE_RAW" || ${#ISSUE_RAW} -lt 200 ]]; then
  fallback_stale "issue fetch failed"
fi

# Extract title
TITLE=$(echo "$ISSUE_RAW" | grep -oE '#[0-9]+ [^—]*' | head -1)
if [[ -z "$TITLE" ]]; then
  TITLE="Issue #${LATEST_ISSUE}"
fi

# Extract the main body: everything between the metadata header and navigation
# Use python for reliable multibyte string handling
BODY=$(python3 -c "
import sys
raw = sys.stdin.read()
# Find content start (after '--- Content ---')
start = raw.find('--- Content ---')
if start >= 0:
    raw = raw[start + 15:]
# Find content end (before version history)
for marker in ['版本紀錄', '← 上一篇', '← 回到列表']:
    end = raw.find(marker)
    if end >= 0:
        raw = raw[:end]
        break
# Clean up
lines = raw.strip().split('\n')
# Skip empty lines and UI chrome
skip = {'☀️','分享','LINE 分享','複製連結','↑','','← 回到列表'}
result = []
for line in lines:
    stripped = line.strip()
    if stripped and stripped not in skip and not stripped.endswith('篇') and not stripped.startswith('←'):
        result.append(stripped)
# Join and cap
output = '\n'.join(result)
print(output[:1800])
" <<< "$ISSUE_RAW" 2>/dev/null)

if [[ -z "$BODY" || ${#BODY} -lt 50 ]]; then
  # Fallback: just use raw content
  BODY=$(echo "$ISSUE_RAW" | head -60 | sed 's/^[[:space:]]*//' | grep -v '^$' | head -30)
fi

# Format output
OUTPUT="=== Claude MAX 俱樂部 (LINE Group) ===
Latest: ${TITLE}
Updated: $(date '+%Y-%m-%d %H:%M')
URL: ${DIGEST_URL}#issue-${LATEST_ISSUE}

${BODY}"

# Cap at 2000 chars
OUTPUT="${OUTPUT:0:2000}"

# Write cache and output
mkdir -p "$CACHE_DIR"
echo "$OUTPUT" > "$CACHE_FILE"
echo "$OUTPUT"
