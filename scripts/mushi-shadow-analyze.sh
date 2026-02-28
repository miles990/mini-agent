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
echo "--- Accuracy Analysis ---"
if [ "$MUSHI_COUNT" -lt 5 ]; then
    echo "Insufficient data (need ≥5 predictions, have ${MUSHI_COUNT})."
    CYCLES_PER_HOUR=5
    echo "Estimated time to 20 predictions: ~$(( (20 - MUSHI_COUNT) / CYCLES_PER_HOUR + 1 )) hours"
    echo "Estimated time to 100 predictions: ~$(( (100 - MUSHI_COUNT) / CYCLES_PER_HOUR + 1 )) hours"
else
    python3 << 'PYEOF'
import json, os, re, sys
from datetime import datetime, timedelta

instance_dir = os.environ.get("INSTANCE_DIR", os.path.expanduser("~/.mini-agent/instances/f6616363"))
server_log = os.path.join(instance_dir, "logs", "server.log")
behavior_dir = os.path.join(instance_dir, "logs", "behavior")

# Parse MUSHI triage entries from server.log
mushi_entries = []
with open(server_log) as f:
    for line in f:
        if "[MUSHI]" not in line or "triage:" not in line:
            continue
        # Format: 2026-02-28 04:21:54 id|Name | [MUSHI] ✅ triage: source → prediction (Xms method) — reason
        m = re.match(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}).*triage: (\S+) → (\w+) \((\d+)ms (\w+)\)", line)
        if m:
            ts_str, source, prediction, latency_ms, method = m.groups()
            ts = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S")
            mushi_entries.append({
                "ts": ts,
                "source": source,
                "prediction": prediction,  # wake or skip
                "latency_ms": int(latency_ms),
                "method": method  # rule or llm
            })

if not mushi_entries:
    print("No parseable MUSHI entries found.")
    sys.exit(0)

# Parse behavior logs to get cycle outcomes
# Each cycle: cycle.start timestamp -> had action.autonomous before cycle.end?
cycles = []
dates_needed = set()
for e in mushi_entries:
    d = e["ts"].strftime("%Y-%m-%d")
    dates_needed.add(d)
    # Also check next day in case cycle spans midnight
    next_d = (e["ts"] + timedelta(days=1)).strftime("%Y-%m-%d")
    dates_needed.add(next_d)

all_events = []
for date in sorted(dates_needed):
    fpath = os.path.join(behavior_dir, f"{date}.jsonl")
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
            ts_str = entry.get("timestamp", "") or entry.get("ts", "")
            if action in ("loop.cycle.start", "loop.cycle.end", "action.autonomous") and ts_str:
                try:
                    ts = datetime.fromisoformat(ts_str.replace("Z", "+00:00")).replace(tzinfo=None)
                except:
                    continue
                all_events.append({"ts": ts, "action": action})

all_events.sort(key=lambda x: x["ts"])

# Build cycle list: [{start_ts, end_ts, had_action}]
current_start = None
had_action = False
for ev in all_events:
    if ev["action"] == "loop.cycle.start":
        current_start = ev["ts"]
        had_action = False
    elif ev["action"] == "action.autonomous":
        had_action = True
    elif ev["action"] == "loop.cycle.end":
        if current_start is not None:
            cycles.append({
                "start": current_start,
                "end": ev["ts"],
                "had_action": had_action
            })
        current_start = None
        had_action = False

# Match each MUSHI entry to the closest cycle (by absolute time distance)
# Server.log and behavior log are both UTC. MUSHI triage and cycle.start
# happen nearly simultaneously (~1s apart), so we match by closest cycle
# within a 5-minute window in either direction.
results = []
for me in mushi_entries:
    best_cycle = None
    best_abs_delta = timedelta(minutes=5)  # max 5 min window
    for c in cycles:
        abs_delta = abs(c["start"] - me["ts"])
        if abs_delta < best_abs_delta:
            best_abs_delta = abs_delta
            best_cycle = c

    if best_cycle:
        actual = "action" if best_cycle["had_action"] else "no-action"
        correct = (me["prediction"] == "wake" and actual == "action") or \
                  (me["prediction"] == "skip" and actual == "no-action")
        results.append({
            "ts": me["ts"],
            "source": me["source"],
            "prediction": me["prediction"],
            "method": me["method"],
            "actual": actual,
            "correct": correct,
            "latency_ms": me["latency_ms"]
        })
    else:
        results.append({
            "ts": me["ts"],
            "source": me["source"],
            "prediction": me["prediction"],
            "method": me["method"],
            "actual": "unmatched",
            "correct": None,
            "latency_ms": me["latency_ms"]
        })

# Calculate metrics
matched = [r for r in results if r["actual"] != "unmatched"]
if not matched:
    print(f"Found {len(mushi_entries)} MUSHI entries but none matched to cycles.")
    sys.exit(0)

correct = sum(1 for r in matched if r["correct"])
total = len(matched)
accuracy = correct / total * 100 if total > 0 else 0

# Confusion matrix
tp = sum(1 for r in matched if r["prediction"] == "wake" and r["actual"] == "action")
tn = sum(1 for r in matched if r["prediction"] == "skip" and r["actual"] == "no-action")
fp = sum(1 for r in matched if r["prediction"] == "wake" and r["actual"] == "no-action")
fn = sum(1 for r in matched if r["prediction"] == "skip" and r["actual"] == "action")

precision_wake = tp / (tp + fp) * 100 if (tp + fp) > 0 else 0
recall_wake = tp / (tp + fn) * 100 if (tp + fn) > 0 else 0
precision_skip = tn / (tn + fn) * 100 if (tn + fn) > 0 else 0
recall_skip = tn / (tn + fp) * 100 if (tn + fp) > 0 else 0

unmatched = len(results) - len(matched)

print(f"Matched {len(matched)}/{len(results)} predictions to cycles ({unmatched} unmatched)")
print(f"")
print(f"Overall accuracy: {accuracy:.1f}% ({correct}/{total})")
print(f"")
print(f"Confusion Matrix:")
print(f"                  Actual: action   Actual: no-action")
print(f"  Predicted wake:    {tp:3d} (TP)         {fp:3d} (FP)")
print(f"  Predicted skip:    {fn:3d} (FN)         {tn:3d} (TN)")
print(f"")
print(f"Wake precision:  {precision_wake:.1f}% (of wake predictions, how many had action)")
print(f"Wake recall:     {recall_wake:.1f}% (of actual actions, how many predicted wake)")
print(f"Skip precision:  {precision_skip:.1f}% (of skip predictions, how many were no-action)")
print(f"Skip recall:     {recall_skip:.1f}% (of actual no-actions, how many predicted skip)")
print(f"")

# Break down by method
llm_results = [r for r in matched if r["method"] == "llm"]
rule_results = [r for r in matched if r["method"] == "rule"]
if llm_results:
    llm_correct = sum(1 for r in llm_results if r["correct"])
    print(f"By method:")
    print(f"  LLM:  {llm_correct}/{len(llm_results)} correct ({llm_correct/len(llm_results)*100:.1f}%)")
if rule_results:
    rule_correct = sum(1 for r in rule_results if r["correct"])
    print(f"  Rule: {rule_correct}/{len(rule_results)} correct ({rule_correct/len(rule_results)*100:.1f}%)")

# Average latency
avg_latency = sum(r["latency_ms"] for r in matched) / len(matched)
llm_latency = [r["latency_ms"] for r in matched if r["method"] == "llm"]
avg_llm_latency = sum(llm_latency) / len(llm_latency) if llm_latency else 0
print(f"")
print(f"Avg latency: {avg_latency:.0f}ms (LLM only: {avg_llm_latency:.0f}ms)")

# Critical metric: false negatives (predicted skip but should have woken)
if fn > 0:
    print(f"")
    print(f"⚠️  FALSE NEGATIVES ({fn}): predicted skip but cycle had action!")
    for r in matched:
        if r["prediction"] == "skip" and r["actual"] == "action":
            print(f"  - {r['ts'].strftime('%H:%M:%S')} source={r['source']} method={r['method']}")

# Token savings estimate
if tn > 0:
    saved_tokens = tn * 50000
    print(f"")
    print(f"💰 Estimated savings if skip predictions were enforced:")
    print(f"   {tn} skipped cycles × ~50K tokens = ~{saved_tokens:,} tokens saved")
PYEOF
fi

echo ""
echo "=== End of Analysis ==="
