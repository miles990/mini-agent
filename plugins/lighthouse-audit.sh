#!/bin/bash
# Lighthouse 網站品質監控（快取版）
# L1: 感知 plugin — 讀取快取的 Lighthouse 結果
# 快取由 scripts/lighthouse-update.sh 定期更新（cron 每 6 小時）

CACHE_FILE="$HOME/.mini-agent/lighthouse-cache.json"
MAX_AGE=21600  # 6 hours in seconds

if [ ! -f "$CACHE_FILE" ]; then
  echo "Lighthouse: No data (run scripts/lighthouse-update.sh to initialize)"
  exit 0
fi

# Check age
if command -v stat &>/dev/null; then
  file_time=$(stat -f %m "$CACHE_FILE" 2>/dev/null || stat -c %Y "$CACHE_FILE" 2>/dev/null)
  now=$(date +%s)
  age=$(( now - file_time ))
  if [ "$age" -gt "$MAX_AGE" ]; then
    stale="(stale — last updated $(( age / 3600 ))h ago)"
  fi
fi

# Read cached scores
python3 -c "
import json, sys
try:
    with open('$CACHE_FILE') as f:
        d = json.load(f)
    scores = d.get('scores', {})
    ts = d.get('timestamp', 'unknown')
    url = d.get('url', 'unknown')
    print(f'Lighthouse Audit ({ts}):')
    print(f'URL: {url}')
    for k, v in scores.items():
        icon = '✅' if v >= 90 else '⚠️' if v >= 50 else '❌'
        print(f'  {icon} {k}: {v}/100')
    issues = d.get('top_issues', [])
    if issues:
        print('Top issues:')
        for i in issues[:3]:
            print(f'  - {i}')
except Exception as e:
    print(f'Lighthouse: Cache read error ({e})')
    sys.exit(0)
" 2>/dev/null

if [ -n "$stale" ]; then
  echo "$stale"
fi
