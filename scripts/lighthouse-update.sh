#!/bin/bash
# 更新 Lighthouse 快取
# 用法: bash scripts/lighthouse-update.sh [url]
# 預設 URL: Kuro 個人網站

URL="${1:-https://miles990.github.io/mini-agent/}"
CACHE_DIR="$HOME/.mini-agent"
CACHE_FILE="$CACHE_DIR/lighthouse-cache.json"
REPORT_FILE="/tmp/lighthouse-report-$$.json"

mkdir -p "$CACHE_DIR"

echo "Running Lighthouse audit on $URL ..."

npx lighthouse "$URL" \
  --output=json \
  --output-path="$REPORT_FILE" \
  --chrome-flags="--headless --no-sandbox" \
  --quiet 2>/dev/null

if [ $? -ne 0 ] || [ ! -f "$REPORT_FILE" ]; then
  echo "ERROR: Lighthouse audit failed"
  exit 1
fi

# Extract scores and top issues into cache
python3 -c "
import json, sys
from datetime import datetime

with open('$REPORT_FILE') as f:
    d = json.load(f)

cats = d.get('categories', {})
scores = {}
for k, v in cats.items():
    s = v.get('score')
    scores[v['title']] = int(s * 100) if s is not None else 0

# Extract top failed audits
issues = []
for audit_id, audit in d.get('audits', {}).items():
    if audit.get('score') is not None and audit['score'] < 0.5:
        title = audit.get('title', audit_id)
        display = audit.get('displayValue', '')
        if display:
            issues.append(f'{title}: {display}')
        else:
            issues.append(title)

# Sort by relevance (shorter = more specific)
issues.sort(key=len)

cache = {
    'url': '$URL',
    'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M'),
    'scores': scores,
    'top_issues': issues[:5]
}

with open('$CACHE_FILE', 'w') as f:
    json.dump(cache, f, indent=2, ensure_ascii=False)

print('Scores:')
for k, v in scores.items():
    icon = '✅' if v >= 90 else '⚠️' if v >= 50 else '❌'
    print(f'  {icon} {k}: {v}/100')
print(f'Cache saved to $CACHE_FILE')
" 2>/dev/null

rm -f "$REPORT_FILE"
