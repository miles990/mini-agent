#!/bin/bash
# 磁碟使用量感知（比內建 system perception 更詳細）
# 顯示各掛載點和大型目錄

echo "=== Mount Points ==="
df -h / /tmp 2>/dev/null | tail -n +2 | awk '{print $6": "$3"/"$2" ("$5" used)"}'

echo ""
echo "=== Home Directory Top 5 ==="
du -sh ~/Desktop ~/Documents ~/Downloads ~/Projects ~/Workspace 2>/dev/null | sort -rh | head -5

echo ""
echo "=== Temp Files ==="
TMPSIZE=$(du -sh /tmp 2>/dev/null | cut -f1)
echo "/tmp: $TMPSIZE"
