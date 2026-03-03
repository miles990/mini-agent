#!/usr/bin/env bash
# collect-trail-data.sh — 收集 Learning Trail 素材
# Usage: ./scripts/collect-trail-data.sh [YYYY-MM-DD]
# 給定日期（預設今天），收集該週（Mon-Sun）的學習素材供 Kuro 整理成 trails/YYYY-WNN.md
set -euo pipefail

INSTANCE_DIR="$HOME/.mini-agent/instances/f6616363"
BEHAVIOR_DIR="$INSTANCE_DIR/logs/behavior"
TOPICS_DIR="memory/topics"
CONVERSATIONS_DIR="memory/conversations"
ACHIEVEMENTS_FILE="$INSTANCE_DIR/achievements.json"
PENDING_FILE="$INSTANCE_DIR/pending-improvements.jsonl"

# Determine target week from given date (default: today)
REF_DATE="${1:-$(date +%Y-%m-%d)}"

# Calculate Monday and Sunday of that week
if [[ "$(uname)" == "Darwin" ]]; then
  DOW=$(date -j -f '%Y-%m-%d' "$REF_DATE" '+%u')  # 1=Mon, 7=Sun
  MONDAY=$(date -j -f '%Y-%m-%d' -v-"$((DOW - 1))"d "$REF_DATE" '+%Y-%m-%d')
  SUNDAY=$(date -j -f '%Y-%m-%d' -v+"$((7 - DOW))"d "$REF_DATE" '+%Y-%m-%d')
  WEEK_NUM=$(date -j -f '%Y-%m-%d' "$MONDAY" '+%V')
  YEAR=$(date -j -f '%Y-%m-%d' "$MONDAY" '+%G')
else
  DOW=$(date -d "$REF_DATE" '+%u')
  MONDAY=$(date -d "$REF_DATE -$((DOW - 1)) days" '+%Y-%m-%d')
  SUNDAY=$(date -d "$REF_DATE +$((7 - DOW)) days" '+%Y-%m-%d')
  WEEK_NUM=$(date -d "$MONDAY" '+%V')
  YEAR=$(date -d "$MONDAY" '+%G')
fi

echo "# Learning Trail 素材 — Week $WEEK_NUM ($MONDAY ~ $SUNDAY)"
echo ""

# --- Section 1: CLASSIFY entries from server.log ---
echo "## CLASSIFY Entries"
echo ""

# Extract clean CLASSIFY lines from server.log
if [[ -f "$INSTANCE_DIR/logs/server.log" ]]; then
  current="$MONDAY"
  while [[ "$current" < "$SUNDAY" ]] || [[ "$current" == "$SUNDAY" ]]; do
    grep "^$current.*\[CLASSIFY\]" "$INSTANCE_DIR/logs/server.log" 2>/dev/null | \
      sed 's/^.* \[CLASSIFY\] /- /' || true

    if [[ "$(uname)" == "Darwin" ]]; then
      current=$(date -j -f '%Y-%m-%d' -v+1d "$current" '+%Y-%m-%d')
    else
      current=$(date -d "$current +1 day" '+%Y-%m-%d')
    fi
  done
fi
echo ""

# --- Section 2: Topics git diff (new/modified entries this week) ---
echo "## Topics Changes (git diff)"
echo ""

if git rev-parse --is-inside-work-tree &>/dev/null; then
  # Find commits in the date range touching topics/
  COMMITS=$(git log --since="$MONDAY" --until="$SUNDAY 23:59:59" --format="%H" -- "$TOPICS_DIR/" 2>/dev/null || true)
  if [[ -n "$COMMITS" ]]; then
    # Show the diff summary
    FIRST_COMMIT=$(echo "$COMMITS" | tail -1)
    git diff "${FIRST_COMMIT}^..HEAD" --stat -- "$TOPICS_DIR/" 2>/dev/null || true
    echo ""
    # Show actual added lines (learning content)
    git diff "${FIRST_COMMIT}^..HEAD" -- "$TOPICS_DIR/" 2>/dev/null | grep '^+[^+]' | head -80 || true
  else
    echo "(No topic changes this week)"
  fi
else
  echo "(Not in git repo)"
fi
echo ""

# --- Section 3: Pending improvements this week ---
echo "## Pending Improvements"
echo ""

if [[ -f "$PENDING_FILE" ]]; then
  # Filter entries within this week's date range
  python3 -c "
import json, sys
monday = '$MONDAY'
sunday = '$SUNDAY'
with open('$PENDING_FILE') as f:
    for line in f:
        line = line.strip()
        if not line: continue
        entry = json.loads(line)
        ts = entry.get('timestamp', '')[:10]
        if monday <= ts <= sunday:
            cat = entry.get('category', '?')
            topic = entry.get('topic', '-')
            content = entry.get('content', '')[:200]
            print(f'- [{cat}] ({topic}) {content}')
" 2>/dev/null || echo "(Failed to parse)"
else
  echo "(No pending-improvements.jsonl)"
fi
echo ""

# --- Section 4: Achievements unlocked this week ---
echo "## Achievements"
echo ""

if [[ -f "$ACHIEVEMENTS_FILE" ]]; then
  python3 -c "
import json
monday = '$MONDAY'
sunday = '$SUNDAY'
with open('$ACHIEVEMENTS_FILE') as f:
    data = json.load(f)
for a in data.get('unlocked', []):
    ts = a.get('unlockedAt', '')[:10]
    if monday <= ts <= sunday:
        print(f'- 🏆 {a[\"id\"]}: {a.get(\"note\", \"\")}')
" 2>/dev/null || echo "(Failed to parse)"
else
  echo "(No achievements.json)"
fi
echo ""

# --- Section 5: Learning-related conversations ---
echo "## Learning Conversations (excerpts)"
echo ""

current="$MONDAY"
while [[ "$current" < "$SUNDAY" ]] || [[ "$current" == "$SUNDAY" ]]; do
  CONV_FILE="$CONVERSATIONS_DIR/$current.jsonl"
  if [[ -f "$CONV_FILE" ]]; then
    python3 -c "
import json
with open('$CONV_FILE') as f:
    for line in f:
        line = line.strip()
        if not line: continue
        msg = json.loads(line)
        text = msg.get('text', '')
        keywords = ['學', '研究', 'read', 'article', 'paper', 'study', 'insight', '洞見', '連結', '觀點', 'learn']
        if any(k in text.lower() for k in keywords):
            fr = msg.get('from', '?')
            mid = msg.get('id', '')
            excerpt = text[:150].replace(chr(10), ' ')
            print(f'- [{mid}] {fr}: {excerpt}...')
" 2>/dev/null || true
  fi

  if [[ "$(uname)" == "Darwin" ]]; then
    current=$(date -j -f '%Y-%m-%d' -v+1d "$current" '+%Y-%m-%d')
  else
    current=$(date -d "$current +1 day" '+%Y-%m-%d')
  fi
done
echo ""

echo "---"
echo "Generated: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
