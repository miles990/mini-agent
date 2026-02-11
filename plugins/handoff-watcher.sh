#!/bin/bash
# Handoff Watcher — 顯示 memory/handoffs/ 中的任務狀態
cd "$(dirname "$0")/../memory/handoffs" 2>/dev/null || exit 0

found=0
for f in *.md; do
  [ -f "$f" ] || continue
  status=$(grep -m1 '^- Status:' "$f" | sed 's/.*Status: //')
  title=$(head -1 "$f" | sed 's/^# Handoff: //')
  echo "  [$status] $title"
  found=1
done

[ "$found" -eq 0 ] && echo "  No handoffs"
