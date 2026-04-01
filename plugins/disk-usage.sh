#!/bin/bash
# 磁碟使用量感知（比內建 system perception 更詳細）
# 顯示各掛載點和大型目錄

echo "=== Disk Usage ==="
# df primary — APFS container includes snapshots/VM/purgeable → misleading percentages
PCT=$(df -h / 2>/dev/null | awk 'NR==2{print $5}' | tr -d '%')
AVAIL=$(df -h / 2>/dev/null | awk 'NR==2{print $4}')
if [ -n "$PCT" ]; then
  echo "/: ${PCT}% used (Available: ${AVAIL})"
else
  df -h / /tmp 2>/dev/null | tail -n +2 | awk '{print $6": "$3"/"$2" ("$5" used)"}'
fi

echo ""
echo "=== Home Directory Top 5 ==="
du -sh ~/Desktop ~/Documents ~/Downloads ~/Projects ~/Workspace 2>/dev/null | sort -rh | head -5

echo ""
echo "=== Temp Files ==="
TMPSIZE=$(du -sh /tmp 2>/dev/null | cut -f1)
echo "/tmp: $TMPSIZE"
