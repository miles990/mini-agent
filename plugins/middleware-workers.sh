#!/bin/bash
# Middleware Worker Service Discovery — 讓 Kuro 看到可用的中台 worker
# stdout 包在 <middleware-workers>...</middleware-workers> 中注入 Agent context
#
# Per Alex 2026-04-17: "中台的 worker 服務發現問題" — Kuro 不會用 worker
# 因為沒看到有什麼、怎麼用。這個 plugin 每次 cycle 把 worker manifest 塞進 context。

MIDDLEWARE_URL="${MIDDLEWARE_URL:-http://localhost:3200}"
CACHE_FILE="${TMPDIR:-/tmp}/mini-agent-mw-workers.cache"
CACHE_TTL=900  # 15 min — workers 改動頻率低

# Use cache if fresh
if [ -f "$CACHE_FILE" ]; then
  mtime=$(stat -f %m "$CACHE_FILE" 2>/dev/null || stat -c %Y "$CACHE_FILE" 2>/dev/null)
  now=$(date +%s)
  if [ -n "$mtime" ] && [ $((now - mtime)) -lt $CACHE_TTL ]; then
    cat "$CACHE_FILE"
    exit 0
  fi
fi

# Fetch capabilities
resp=$(curl -sf --max-time 5 "$MIDDLEWARE_URL/api/workers/capabilities" 2>/dev/null)
if [ -z "$resp" ]; then
  echo "middleware unreachable ($MIDDLEWARE_URL/api/workers/capabilities)"
  exit 0
fi

# Format for agent context (concise)
output=$(echo "$resp" | python3 -c "
import json, sys
try:
  data = json.load(sys.stdin)
except:
  print('parse error')
  sys.exit(0)

workers = data.get('workers', [])
print(f'Middleware @ {\"${MIDDLEWARE_URL}\"} — {len(workers)} workers available. Invoke via <kuro:delegate type=\"...\"> (routed through BAR) or direct /dispatch.')
print()
# Group by backend
groups = {}
for w in workers:
  groups.setdefault(w.get('backend', 'unknown'), []).append(w)
for backend, ws in sorted(groups.items()):
  print(f'## {backend} backend ({len(ws)})')
  for w in sorted(ws, key=lambda x: x['name']):
    name = w['name']
    desc = (w.get('description') or '').replace('\n', ' ')[:200]
    model = w.get('model', '-') or '-'
    maxc = w.get('maxConcurrency', '-')
    print(f'- **{name}** (model={model}, maxC={maxc}): {desc}')
  print()
" 2>&1)

echo "$output" | tee "$CACHE_FILE"
