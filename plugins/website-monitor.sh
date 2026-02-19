#!/bin/bash
# Kuro 個人網站存活監控
# L1: 感知 plugin — 每個 loop cycle 檢查網站是否正常

URL="https://kuro.page"
TIMEOUT=10

status=$(curl -sf -o /dev/null -w "%{http_code}" --max-time $TIMEOUT "$URL" 2>/dev/null)

if [ "$status" = "200" ]; then
  echo "Website: UP (HTTP $status)"
  echo "URL: $URL"
else
  if [ -z "$status" ] || [ "$status" = "000" ]; then
    echo "Website: DOWN (timeout/unreachable)"
  else
    echo "Website: DEGRADED (HTTP $status)"
  fi
  echo "URL: $URL"
  echo "ALERT: Website not returning 200"
fi
