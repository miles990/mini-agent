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
    status=$(jq -r --arg tid "$task_id" '
      (.status // "?") as $s
      | (.duration // 0) as $dur
      | (.verifyResults // []) as $vr
      | ($vr | length) as $tv
      | ($vr | map(select(.passed)) | length) as $pv
      | (if $s == "completed" then "✅"
         elif $s == "failed" then "❌"
         elif $s == "timeout" then "⏱"
         else "?" end) as $icon
      | (if $dur > 0 then "\($dur / 1000 | floor)s" else "?" end) as $durs
      | if $tv > 0
        then "\($icon) \($tid): \($s) (\($durs), \($pv)/\($tv) verify passed)"
        else "\($icon) \($tid): \($s) (\($durs))"
        end
    ' "$result_file" 2>/dev/null)
    echo "${status:-? $task_id: error reading result}"
  elif [ -f "$spec_file" ]; then
    start_time=$(stat -f %m "$spec_file" 2>/dev/null || stat -c %Y "$spec_file" 2>/dev/null)
    now=$(date +%s)
    elapsed=$(( now - start_time ))
    prompt=$(jq -r '(.prompt // "")[0:60]' "$spec_file" 2>/dev/null)
    echo "⏳ $task_id: running (${elapsed}s) — $prompt..."
  fi
done
