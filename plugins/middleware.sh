#!/bin/bash
# Middleware — Agent Infrastructure Layer perception
# stdout 包在 <middleware>...</middleware> 注入 Agent context
#
# 呼叫 agent-middleware /health，列出 workers + task 計數。
# Middleware 離線時 graceful output（不 crash）。

MIDDLEWARE_URL="${MIDDLEWARE_URL:-http://localhost:3200}"
TIMEOUT="${MIDDLEWARE_TIMEOUT:-3}"

response=$(curl -sf --max-time "$TIMEOUT" "$MIDDLEWARE_URL/health" 2>/dev/null)
curl_exit=$?

if [ $curl_exit -ne 0 ] || [ -z "$response" ]; then
  echo "offline ($MIDDLEWARE_URL) — \`<kuro:plan>\` will degrade to no-op log"
  exit 0
fi

echo "$response" | python3 -c "
import json, sys
try:
    d = json.load(sys.stdin)
    status = d.get('status', '?')
    service = d.get('service', 'middleware')
    workers = d.get('workers', [])
    tasks = d.get('tasks', 0)

    print(f'status: {status} · {service}')
    if workers:
        print(f'workers ({len(workers)}): ' + ', '.join(workers[:10]))
        if len(workers) > 10:
            print(f'  +{len(workers) - 10} more')
    print(f'active tasks: {tasks}')
except Exception as e:
    print(f'parse error: {e}')
" 2>/dev/null
