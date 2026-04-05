#!/usr/bin/env bash
# knowledge-synthesis.sh — Periodic knowledge contradiction scan
#
# Scans source_*.md files for new additions since last scan,
# outputs structured data for the OODA cycle to trigger analysis.
#
# Usage: bash scripts/knowledge-synthesis.sh
#
# Designed to run as housekeeping/cron task.
# When new sources are found, creates a flag file that the main cycle picks up.

set -euo pipefail

MEMORY_DIR="${CLAUDE_MEMORY_DIR:-$HOME/.claude/projects/-Users-user--mini-agent-subprocess/memory}"
STATE_FILE="$HOME/.mini-agent/knowledge-synthesis-state.json"
FLAG_FILE="$HOME/.mini-agent/knowledge-synthesis-needed"

# ── Count current sources ──
CURRENT_COUNT=$(ls "$MEMORY_DIR"/source_*.md 2>/dev/null | wc -l | tr -d ' ')
CURRENT_FILES=$(ls "$MEMORY_DIR"/source_*.md 2>/dev/null | sort)

# ── Load last scan state ──
LAST_COUNT=0
LAST_SCAN=""
if [[ -f "$STATE_FILE" ]]; then
  LAST_COUNT=$(jq -r '.count // 0' "$STATE_FILE" 2>/dev/null || echo 0)
  LAST_SCAN=$(jq -r '.last_scan // ""' "$STATE_FILE" 2>/dev/null || echo "")
fi

# ── Check for tension/index files ──
TENSIONS_EXISTS="false"
INDEX_EXISTS="false"
[[ -f "$MEMORY_DIR/topics/knowledge-tensions.md" ]] && TENSIONS_EXISTS="true"
[[ -f "$MEMORY_DIR/topics/isc-concept-index.md" ]] && INDEX_EXISTS="true"

# ── Determine if rescan needed ──
NEW_COUNT=$((CURRENT_COUNT - LAST_COUNT))
NEEDS_SCAN="false"

if [[ $NEW_COUNT -gt 5 ]]; then
  NEEDS_SCAN="true"
  REASON="$NEW_COUNT new source files since last scan ($LAST_COUNT → $CURRENT_COUNT)"
elif [[ "$TENSIONS_EXISTS" == "false" ]]; then
  NEEDS_SCAN="true"
  REASON="knowledge-tensions.md not found"
elif [[ "$INDEX_EXISTS" == "false" ]]; then
  NEEDS_SCAN="true"
  REASON="isc-concept-index.md not found"
fi

# ── Find new files (if any) ──
NEW_FILES=""
if [[ -n "$LAST_SCAN" && $NEW_COUNT -gt 0 ]]; then
  # Find files newer than last scan
  NEW_FILES=$(find "$MEMORY_DIR" -name "source_*.md" -newer "$STATE_FILE" 2>/dev/null | sort)
fi

# ── Output report ──
echo "=== Knowledge Synthesis Status ==="
echo "Total sources: $CURRENT_COUNT"
echo "Last scan: ${LAST_SCAN:-never}"
echo "New since last scan: $NEW_COUNT"
echo "Tensions file: $TENSIONS_EXISTS"
echo "ISC index file: $INDEX_EXISTS"
echo "Needs rescan: $NEEDS_SCAN"

if [[ "$NEEDS_SCAN" == "true" ]]; then
  echo "Reason: $REASON"

  if [[ -n "$NEW_FILES" ]]; then
    echo ""
    echo "New files:"
    echo "$NEW_FILES" | while read -r f; do
      echo "  - $(basename "$f")"
    done
  fi

  # Create flag file for main cycle to pick up
  cat > "$FLAG_FILE" <<EOF
{
  "needed": true,
  "reason": "$REASON",
  "current_count": $CURRENT_COUNT,
  "new_count": $NEW_COUNT,
  "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  echo ""
  echo "Flag file created: $FLAG_FILE"
fi

# ── Update state ──
cat > "$STATE_FILE" <<EOF
{
  "count": $CURRENT_COUNT,
  "last_scan": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "tensions_exists": $TENSIONS_EXISTS,
  "index_exists": $INDEX_EXISTS
}
EOF

echo ""
echo "State updated: $STATE_FILE"
