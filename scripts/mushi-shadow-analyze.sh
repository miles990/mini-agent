#!/bin/bash
# mushi-shadow-analyze.sh — Analyze mushi shadow mode predictions vs actual cycle outcomes
# Usage: ./scripts/mushi-shadow-analyze.sh [days=7]
#
# Correlates [MUSHI] triage predictions in server.log with actual cycle
# outcomes (action/no-action) in behavior JSONL. Outputs accuracy metrics.

set -euo pipefail

INSTANCE_DIR="${HOME}/.mini-agent/instances/${MINI_AGENT_INSTANCE:-f6616363}"
SERVER_LOG="${INSTANCE_DIR}/logs/server.log"
BEHAVIOR_DIR="${INSTANCE_DIR}/logs/behavior"
DAYS="${1:-7}"

echo "=== mushi Shadow Mode Analysis ==="
echo "Instance: ${MINI_AGENT_INSTANCE:-f6616363}"
echo "Period: last ${DAYS} days"
echo ""

# --- Part 1: Baseline (no-action rate without mushi) ---
echo "--- Baseline: No-Action Rate ---"
python3 << 'PYEOF'
import json, os, sys
from datetime import datetime, timedelta
from collections import defaultdict

log_dir = os.environ.get("BEHAVIOR_DIR", os.path.expanduser("~/.mini-agent/instances/f6616363/logs/behavior"))
days = int(os.environ.get("DAYS", "7"))

today = datetime.now()
dates = [(today - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(days)]
dates.reverse()

total_cycles = 0
total_action = 0
total_no_action = 0
current_cycle = None

for date in dates:
    fpath = os.path.join(log_dir, f"{date}.jsonl")
    if not os.path.exists(fpath):
        continue
    with open(fpath) as f:
        for line in f:
            try:
                entry = json.loads(line.strip())
            except:
                continue
            data = entry.get("data", {})
            action = data.get("action", "")

            if action == "loop.cycle.start":
                if current_cycle is not None:
                    total_cycles += 1
                    if current_cycle:
                        total_action += 1
                    else:
                        total_no_action += 1
                current_cycle = False
            elif action == "action.autonomous":
                if current_cycle is not None:
                    current_cycle = True
            elif action == "loop.cycle.end":
                if current_cycle is not None:
                    total_cycles += 1
                    if current_cycle:
                        total_action += 1
                    else:
                        total_no_action += 1
                    current_cycle = None

if current_cycle is not None:
    total_cycles += 1
    if current_cycle:
        total_action += 1
    else:
        total_no_action += 1

if total_cycles == 0:
    print("No cycle data found.")
    sys.exit(0)

waste_pct = total_no_action / total_cycles * 100
token_waste = total_no_action * 50000  # ~50K tokens per cycle

print(f"Total cycles:     {total_cycles}")
print(f"Action cycles:    {total_action} ({total_action/total_cycles*100:.1f}%)")
print(f"No-action cycles: {total_no_action} ({waste_pct:.1f}%)")
print(f"Est. wasted tokens: {token_waste:,} ({token_waste/1_000_000:.1f}M)")
print(f"If mushi catches 80%: saves ~{int(total_no_action * 0.8 * 50000):,} tokens")
PYEOF

echo ""

# --- Part 2: Shadow Mode Predictions ---
echo "--- Shadow Mode Predictions ---"
MUSHI_COUNT=$(grep -c '\[MUSHI\].*triage:' "$SERVER_LOG" 2>/dev/null || echo "0")
echo "Total MUSHI triage entries: ${MUSHI_COUNT}"

if [ "$MUSHI_COUNT" -gt 0 ]; then
    echo ""
    echo "Predictions breakdown:"
    grep '\[MUSHI\].*triage:' "$SERVER_LOG" | sed -E 's/.*→ ([a-z]+) .*/\1/' | sort | uniq -c | sort -rn
    echo ""
    echo "By method:"
    grep '\[MUSHI\].*triage:' "$SERVER_LOG" | sed -E 's/.*\([0-9]+ms ([a-z]+)\).*/\1/' | sort | uniq -c | sort -rn
    echo ""
    echo "By source:"
    grep '\[MUSHI\].*triage:' "$SERVER_LOG" | sed -E 's/.*triage: ([a-z-]+) .*/\1/' | sort | uniq -c | sort -rn
    echo ""
    echo "Recent entries:"
    grep '\[MUSHI\].*triage:' "$SERVER_LOG" | tail -10
fi

echo ""

# --- Part 3: Accuracy (when enough data) ---
if [ "$MUSHI_COUNT" -ge 20 ]; then
    echo "--- Accuracy Analysis ---"
    echo "(Requires correlation with cycle outcomes — TODO: implement when data sufficient)"
    # Future: correlate MUSHI prediction timestamps with behavior log cycle outcomes
    # Match by finding the cycle.start closest to each MUSHI entry
else
    echo "--- Accuracy Analysis ---"
    echo "Insufficient data (need ≥20 predictions, have ${MUSHI_COUNT})."
    echo "Estimated time to 20 predictions: ~$(( (20 - MUSHI_COUNT) / 5 + 1 )) hours"
    echo "Estimated time to 100 predictions: ~$(( (100 - MUSHI_COUNT) / 5 + 1 )) hours"
fi

echo ""
echo "=== End of Analysis ==="
