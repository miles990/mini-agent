#!/bin/bash
# 磁碟使用量感知（比內建 system perception 更詳細）
# 顯示各掛載點和大型目錄

echo "=== APFS Container ==="
if command -v diskutil &>/dev/null; then
  CINFO=$(diskutil info / 2>/dev/null)
  TOTAL=$(echo "$CINFO" | awk '/Container Total Space/{$1=$2=$3=""; sub(/^  +/,"",$0); print $0}')
  FREE=$(echo "$CINFO" | awk '/Container Free Space/{$1=$2=$3=""; sub(/^  +/,"",$0); print $0}')
  TOTAL_B=$(echo "$CINFO" | awk -F'[()]' '/Container Total Space/{print $2}' | awk '{print $1}')
  FREE_B=$(echo "$CINFO" | awk -F'[()]' '/Container Free Space/{print $2}' | awk '{print $1}')
  if [ -n "$TOTAL_B" ] && [ -n "$FREE_B" ] && [ "$TOTAL_B" -gt 0 ] 2>/dev/null; then
    PCT=$(( (TOTAL_B - FREE_B) * 100 / TOTAL_B ))
    echo "/: ${PCT}% used (Free: ${FREE})"
  fi
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
