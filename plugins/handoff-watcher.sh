#!/bin/bash
# Handoff Watcher — 顯示 memory/handoffs/ 中的任務狀態（含 To + Depends-on 檢查）
cd "$(dirname "$0")/../memory/handoffs" 2>/dev/null || exit 0

found=0
for f in *.md; do
  [ -f "$f" ] || continue
  status=$(grep -m1 '^- Status:' "$f" | sed 's/.*Status: //')
  to=$(grep -m1 '^- To:' "$f" | sed 's/.*To: //')
  title=$(head -1 "$f" | sed 's/^# Handoff: //')
  deps=$(grep -m1 '^- Depends-on:' "$f" | sed 's/.*Depends-on: //')

  # 檢查 Depends-on 是否存在且 completed
  dep_warn=""
  if [ -n "$deps" ]; then
    IFS=',' read -ra dep_list <<< "$deps"
    for dep in "${dep_list[@]}"; do
      dep=$(echo "$dep" | xargs)  # trim whitespace
      if [ ! -f "$dep" ]; then
        dep_warn=" ⚠️ dep:$dep not found"
      elif ! grep -q '^- Status:.*completed' "$dep" 2>/dev/null; then
        dep_warn=" ⚠️ dep:$dep not completed"
      fi
    done
  fi

  # 格式：[status → to] title
  if [ -n "$to" ]; then
    echo "  [$status → $to] $title$dep_warn"
  else
    echo "  [$status] $title$dep_warn"
  fi
  found=1
done

[ "$found" -eq 0 ] && echo "  No handoffs"
