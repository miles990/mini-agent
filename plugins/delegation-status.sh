#!/bin/bash
# Delegation Status — 非同步任務委派狀態
# stdout 會被包在 <delegation-status>...</delegation-status> 中注入 Agent context

INSTANCE_ID="${MINI_AGENT_INSTANCE:-unknown}"
INSTANCE_DIR="$HOME/.mini-agent/instances/$INSTANCE_ID"
DEL_DIR="$INSTANCE_DIR/delegations"

if [ ! -d "$DEL_DIR" ]; then
  echo "No delegations yet"
  exit 0
fi

# Count directories
total=$(find "$DEL_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')
if [ "$total" = "0" ]; then
  echo "No delegations yet"
  exit 0
fi

echo "=== Delegations ==="

# Check each delegation directory
for dir in "$DEL_DIR"/*/; do
  [ -d "$dir" ] || continue
  task_id=$(basename "$dir")
  result_file="$dir/result.json"
  spec_file="$dir/spec.json"

  if [ -f "$result_file" ]; then
    # Completed task — read result
    status=$(python3 -c "
import json, sys
try:
    d = json.load(open('$result_file'))
    s = d.get('status', '?')
    dur = d.get('duration', 0)
    dur_s = f'{dur // 1000}s' if dur else '?'
    vr = d.get('verifyResults', [])
    if vr:
        passed = sum(1 for v in vr if v.get('passed'))
        total_v = len(vr)
        icon = '✅' if s == 'completed' else '❌'
        print(f'{icon} {task_id}: {s} ({dur_s}, {passed}/{total_v} verify passed)')
    else:
        icon = '✅' if s == 'completed' else '❌' if s == 'failed' else '⏱' if s == 'timeout' else '?'
        print(f'{icon} {task_id}: {s} ({dur_s})')
except Exception as e:
    print(f'? {task_id}: error reading result')
" 2>/dev/null)
    echo "$status"
  elif [ -f "$spec_file" ]; then
    # Running task — show elapsed time
    start_time=$(stat -f %m "$spec_file" 2>/dev/null || stat -c %Y "$spec_file" 2>/dev/null)
    now=$(date +%s)
    elapsed=$(( now - start_time ))
    prompt=$(python3 -c "
import json
d = json.load(open('$spec_file'))
p = d.get('prompt', '')[:60]
print(p)
" 2>/dev/null)
    echo "⏳ $task_id: running (${elapsed}s) — $prompt..."
  fi
done
