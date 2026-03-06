#!/bin/bash
# Chrome tab tracking — browsing pattern awareness
# Tracks tab changes over time, records history, outputs browsing summary
# stdout -> <chrome-tabs>...</chrome-tabs> in Agent context

STATE_DIR="${HOME}/.mini-agent"
SNAPSHOT="$STATE_DIR/chrome-tabs-snapshot.json"
HISTORY="$STATE_DIR/chrome-tabs-history.jsonl"
CDP_PORT="${CDP_PORT:-9222}"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)
NOW_EPOCH=$(date +%s)

# Ensure state dir
mkdir -p "$STATE_DIR"

# Fetch current tabs from CDP
TABS=$(curl -sf --max-time 3 "http://localhost:${CDP_PORT}/json/list" 2>/dev/null)
if [ $? -ne 0 ] || [ -z "$TABS" ]; then
  echo "CDP: offline"
  exit 0
fi

# Filter to real pages (skip chrome://, extensions, service workers, blob:)
CURRENT=$(echo "$TABS" | python3 -c "
import sys, json
tabs = json.load(sys.stdin)
real = []
for t in tabs:
    url = t.get('url', '')
    typ = t.get('type', '')
    if typ != 'page':
        continue
    if any(url.startswith(p) for p in ['chrome://', 'chrome-extension://', 'blob:', 'devtools://']):
        continue
    real.append({'url': url, 'title': t.get('title', '')[:80], 'id': t.get('id', '')})
json.dump(real, sys.stdout)
" 2>/dev/null)

if [ -z "$CURRENT" ]; then
  echo "CDP: OK, no browsable tabs"
  exit 0
fi

# Load previous snapshot
PREV="[]"
PREV_EPOCH="$NOW_EPOCH"
if [ -f "$SNAPSHOT" ]; then
  PREV=$(python3 -c "
import json, sys
try:
    with open('$SNAPSHOT') as f:
        data = json.load(f)
    json.dump(data.get('tabs', []), sys.stdout)
except: json.dump([], sys.stdout)
" 2>/dev/null)
  PREV_EPOCH=$(python3 -c "
import json
try:
    with open('$SNAPSHOT') as f:
        data = json.load(f)
    print(data.get('epoch', $NOW_EPOCH))
except: print($NOW_EPOCH)
" 2>/dev/null)
fi

# Compare and output
python3 -c "
import json, sys

current = json.loads('''$CURRENT''')
prev = json.loads('''$PREV''')
now_epoch = $NOW_EPOCH
prev_epoch = int('$PREV_EPOCH')
elapsed = now_epoch - prev_epoch

prev_urls = {t['url'] for t in prev}
curr_urls = {t['url'] for t in current}

opened = curr_urls - prev_urls
closed = prev_urls - curr_urls

# Output current tabs
print(f'Tabs ({len(current)}):')
for t in current[:8]:
    marker = ' [NEW]' if t['url'] in opened else ''
    title = t['title'][:50] if t['title'] else '(untitled)'
    # Domain extraction
    url = t['url']
    try:
        from urllib.parse import urlparse
        domain = urlparse(url).netloc
        if domain.startswith('www.'): domain = domain[4:]
    except:
        domain = url[:40]
    print(f'  {title} ({domain}){marker}')

if len(current) > 8:
    print(f'  ... +{len(current)-8} more')

# Show changes
if opened and elapsed > 0:
    for t in current:
        if t['url'] in opened:
            title = t['title'][:40] if t['title'] else '(untitled)'
            print(f'  + Opened: {title}')

if closed and elapsed > 0:
    for t in prev:
        if t['url'] in closed:
            title = t['title'][:40] if t['title'] else '(untitled)'
            print(f'  - Closed: {title}')

# Dwell time for persistent tabs
if elapsed > 120:
    persistent = curr_urls & prev_urls
    if persistent:
        mins = elapsed // 60
        print(f'Persistent ({mins}min): {len(persistent)} tabs unchanged')
" 2>/dev/null

# Record changes to history (ring buffer, keep last 200 lines)
python3 -c "
import json, sys

current = json.loads('''$CURRENT''')
prev = json.loads('''$PREV''')
now = '$NOW'

prev_urls = {t['url'] for t in prev}
curr_urls = {t['url'] for t in current}
opened = curr_urls - prev_urls
closed = prev_urls - curr_urls

events = []
for t in current:
    if t['url'] in opened:
        events.append({'ts': now, 'event': 'open', 'url': t['url'], 'title': t['title']})
for t in prev:
    if t['url'] in closed:
        events.append({'ts': now, 'event': 'close', 'url': t['url'], 'title': t['title']})

if events:
    with open('$HISTORY', 'a') as f:
        for e in events:
            f.write(json.dumps(e) + '\n')
" 2>/dev/null

# Trim history to 200 lines
if [ -f "$HISTORY" ]; then
  LINES=$(wc -l < "$HISTORY" | tr -d ' ')
  if [ "$LINES" -gt 200 ]; then
    tail -200 "$HISTORY" > "${HISTORY}.tmp" && mv "${HISTORY}.tmp" "$HISTORY"
  fi
fi

# Save current snapshot
python3 -c "
import json
current = json.loads('''$CURRENT''')
with open('$SNAPSHOT', 'w') as f:
    json.dump({'tabs': current, 'epoch': $NOW_EPOCH, 'ts': '$NOW'}, f)
" 2>/dev/null
