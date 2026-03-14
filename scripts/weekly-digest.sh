#!/usr/bin/env bash
# weekly-digest.sh — 聚合過去 7 天的行為/對話/學習數據
#
# 用途：為 weekly-retrospective skill 提供壓縮的週報數據
# 輸出：結構化純文字摘要（~3-8K chars），適合 Claude context 消化
#
# Usage: bash scripts/weekly-digest.sh [instance-id]
#        bash scripts/weekly-digest.sh              # 自動偵測 instance

set -euo pipefail

# ── Instance detection ──
INSTANCE_ID="${1:-}"
INSTANCE_DIR=""

if [[ -n "$INSTANCE_ID" ]]; then
  INSTANCE_DIR="$HOME/.mini-agent/instances/$INSTANCE_ID"
else
  # Auto-detect: find most recent instance
  INSTANCE_DIR=$(ls -dt "$HOME/.mini-agent/instances"/*/ 2>/dev/null | head -1)
  INSTANCE_ID=$(basename "$INSTANCE_DIR" 2>/dev/null || echo "unknown")
fi

if [[ ! -d "$INSTANCE_DIR" ]]; then
  echo "Error: Instance directory not found: $INSTANCE_DIR" >&2
  exit 1
fi

BEHAVIOR_DIR="$INSTANCE_DIR/logs/behavior"
CONVERSATION_DIR="./memory/conversations"
TOPICS_DIR="./memory/topics"

# ── Date range (past 7 days) ──
DATES=()
for i in $(seq 0 6); do
  if [[ "$(uname)" == "Darwin" ]]; then
    DATES+=("$(date -v-${i}d +%Y-%m-%d)")
  else
    DATES+=("$(date -d "$i days ago" +%Y-%m-%d)")
  fi
done

echo "# Weekly Digest"
echo "Period: ${DATES[6]} → ${DATES[0]}"
echo "Instance: $INSTANCE_ID"
echo ""

# ══════════════════════════════════════════════════════════════
# Section 1: Action Summary（行為分類統計）
# ══════════════════════════════════════════════════════════════
echo "## Actions"
echo ""

# Collect all behavior logs for the week
BEHAVIOR_DATA=""
for d in "${DATES[@]}"; do
  f="$BEHAVIOR_DIR/$d.jsonl"
  [[ -f "$f" ]] && BEHAVIOR_DATA+=$(cat "$f")$'\n'
done

if [[ -n "$BEHAVIOR_DATA" ]]; then
  # Count by action category
  echo "| Category | Count |"
  echo "|----------|-------|"

  # Extract action field, group by prefix
  echo "$BEHAVIOR_DATA" | grep -o '"action":"[^"]*"' | sed 's/"action":"//;s/"//' | \
    awk -F'.' '{print $1"."$2}' | sort | uniq -c | sort -rn | head -20 | \
    while read count action; do
      echo "| $action | $count |"
    done

  echo ""

  # Total entries
  TOTAL=$(echo "$BEHAVIOR_DATA" | grep -c '"action"' || true)
  echo "Total actions: $TOTAL"
  echo ""
fi

# ══════════════════════════════════════════════════════════════
# Section 2: Key Decisions & Actions（重要決策和動作）
# ══════════════════════════════════════════════════════════════
echo "## Key Decisions & Actions"
echo ""

if [[ -n "$BEHAVIOR_DATA" ]]; then
  # Extract significant actions (chat, deploy, remember, task, delegate)
  echo "$BEHAVIOR_DATA" | grep -E '"action":"(telegram\.chat|loop\.cycle|cron\.execute|memory\.remember|delegation\.spawn|room\.message)"' | \
    grep '"actor":"agent"' | \
    grep -o '"detail":"[^"]*"' | sed 's/"detail":"//;s/"$//' | \
    head -c 500 | fold -w 120 -s | head -30

  echo ""

  # Delegation activity
  DELEGATE_COUNT=$(echo "$BEHAVIOR_DATA" | grep -c '"delegation.spawn"' || true)
  DELEGATE_COMPLETE=$(echo "$BEHAVIOR_DATA" | grep -c '"delegation.complete"' || true)
  if [[ $DELEGATE_COUNT -gt 0 ]]; then
    echo "Delegations: spawned=$DELEGATE_COUNT, completed=$DELEGATE_COMPLETE"
    echo ""
  fi
fi

# ══════════════════════════════════════════════════════════════
# Section 3: Topics Touched（本週觸及的主題）
# ══════════════════════════════════════════════════════════════
echo "## Topics Activity"
echo ""

if [[ -d "$TOPICS_DIR" ]]; then
  echo "| Topic | Entries This Week | Total Size |"
  echo "|-------|-------------------|------------|"

  for f in "$TOPICS_DIR"/*.md; do
    [[ ! -f "$f" ]] && continue
    topic=$(basename "$f" .md)
    total_size=$(wc -c < "$f" | tr -d ' ')

    # Count entries added this week (lines with dates in range)
    week_entries=0
    for d in "${DATES[@]}"; do
      count=$(grep -c "\[$d\]" "$f" 2>/dev/null || true)
      week_entries=$((week_entries + count))
    done

    if [[ $week_entries -gt 0 ]]; then
      echo "| $topic | $week_entries | ${total_size}B |"
    fi
  done

  # Also check for topics with zero activity (idle)
  echo ""
  echo "Idle topics (0 entries this week):"
  for f in "$TOPICS_DIR"/*.md; do
    [[ ! -f "$f" ]] && continue
    topic=$(basename "$f" .md)
    week_entries=0
    for d in "${DATES[@]}"; do
      count=$(grep -c "\[$d\]" "$f" 2>/dev/null || true)
      week_entries=$((week_entries + count))
    done
    if [[ $week_entries -eq 0 ]]; then
      echo "  - $topic"
    fi
  done
  echo ""
fi

# ══════════════════════════════════════════════════════════════
# Section 4: Conversations with Alex（與 Alex 的對話主題）
# ══════════════════════════════════════════════════════════════
echo "## Conversations"
echo ""

CONV_DATA=""
for d in "${DATES[@]}"; do
  f="$CONVERSATION_DIR/$d.jsonl"
  [[ -f "$f" ]] && CONV_DATA+=$(cat "$f")$'\n'
done

if [[ -n "$CONV_DATA" ]]; then
  # Count messages by sender
  echo "Messages by sender:"
  echo "$CONV_DATA" | grep -o '"from":"[^"]*"' | sed 's/"from":"//;s/"//' | \
    sort | uniq -c | sort -rn | while read count from; do
      echo "  $from: $count"
    done
  echo ""

  # Extract Alex's messages (actual human direction)
  echo "Alex's messages (direction/decisions):"
  echo "$CONV_DATA" | grep '"from":"alex"' | \
    grep -o '"text":"[^"]*"' | sed 's/"text":"//;s/"$//' | \
    while IFS= read -r line; do
      # Truncate long messages
      echo "  - ${line:0:150}"
    done | head -30
  echo ""
fi

# ══════════════════════════════════════════════════════════════
# Section 5: Errors & Problems（錯誤和問題）
# ══════════════════════════════════════════════════════════════
echo "## Errors & Problems"
echo ""

ERROR_COUNT=0
for d in "${DATES[@]}"; do
  f="$INSTANCE_DIR/logs/error/$d.jsonl"
  if [[ -f "$f" ]]; then
    c=$(wc -l < "$f" | tr -d ' ')
    ERROR_COUNT=$((ERROR_COUNT + c))
  fi
done
echo "Total errors this week: $ERROR_COUNT"

if [[ $ERROR_COUNT -gt 0 ]]; then
  echo ""
  echo "Error patterns:"
  for d in "${DATES[@]}"; do
    f="$INSTANCE_DIR/logs/error/$d.jsonl"
    [[ -f "$f" ]] && cat "$f"
  done | grep -o '"error":"[^"]*"' | sed 's/"error":"//;s/"$//' | \
    sort | uniq -c | sort -rn | head -10 | \
    while read count err; do
      echo "  ×$count: ${err:0:120}"
    done
fi
echo ""

# ══════════════════════════════════════════════════════════════
# Section 6: Git Activity（程式碼變更）
# ══════════════════════════════════════════════════════════════
echo "## Git Activity"
echo ""

SINCE_DATE="${DATES[6]}"
COMMIT_COUNT=$(git log --since="$SINCE_DATE" --oneline 2>/dev/null | wc -l | tr -d ' ')
echo "Commits since $SINCE_DATE: $COMMIT_COUNT"
echo ""

if [[ $COMMIT_COUNT -gt 0 ]]; then
  echo "Notable commits:"
  git log --since="$SINCE_DATE" --oneline --no-merges 2>/dev/null | \
    grep -v "chore(auto)\|chore(memory)" | head -15 | \
    while IFS= read -r line; do
      echo "  $line"
    done
  echo ""

  echo "Files changed:"
  git diff --stat "$(git log --since="$SINCE_DATE" --format=%H --reverse 2>/dev/null | head -1)..HEAD" 2>/dev/null | tail -3
  echo ""
fi

# ══════════════════════════════════════════════════════════════
# Section 7: HEARTBEAT Status（策略任務狀態）
# ══════════════════════════════════════════════════════════════
echo "## HEARTBEAT Snapshot"
echo ""

if [[ -f "memory/HEARTBEAT.md" ]]; then
  # Extract pending and completed tasks
  grep -E "^- \[[ x]\]" memory/HEARTBEAT.md 2>/dev/null | head -20
fi
echo ""

echo "---"
echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
