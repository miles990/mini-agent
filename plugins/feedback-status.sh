#!/bin/bash
# Feedback Loop Status — 三個智能回饋迴路的健康狀態
# stdout 會被包在 <feedback-status>...</feedback-status> 中注入 Agent context

INSTANCE_ID="${MINI_AGENT_INSTANCE:-unknown}"
INSTANCE_DIR="$HOME/.mini-agent/instances/$INSTANCE_ID"

echo "=== Feedback Loops ==="

# ─── Error Patterns ─────────────────────────────
EP_FILE="$INSTANCE_DIR/error-patterns.json"
if [ -f "$EP_FILE" ]; then
    active=$(python3 -c "
import json, sys
try:
    d = json.load(open('$EP_FILE'))
    active = [(k, v) for k, v in d.items() if v.get('taskCreated')]
    if active:
        parts = [f\"{k.split('::')[0]} x{v['count']}\" for k, v in active[:3]]
        print(f'Error patterns: {len(active)} active ({', '.join(parts)})')
    else:
        print('Error patterns: clean')
except:
    print('Error patterns: no data')
" 2>/dev/null)
    echo "$active"
else
    echo "Error patterns: no data"
fi

# ─── Perception Citations ────────────────────────
PC_FILE="$INSTANCE_DIR/perception-citations.json"
if [ -f "$PC_FILE" ]; then
    python3 -c "
import json, sys
try:
    d = json.load(open('$PC_FILE'))
    cycles = d.get('cycleCount', 0)
    cites = d.get('citations', {})
    total = sum(cites.values())
    if total > 0:
        top3 = sorted(cites.items(), key=lambda x: -x[1])[:3]
        parts = [f'{k} {v*100//total}%' for k, v in top3]
        print(f'Perception citations: {', '.join(parts)} ({cycles} cycles)')
    else:
        print(f'Perception citations: no data ({cycles} cycles)')
except:
    print('Perception citations: no data')
" 2>/dev/null
else
    echo "Perception citations: no data"
fi

# ─── Decision Quality ────────────────────────────
DQ_FILE="$INSTANCE_DIR/decision-quality.json"
if [ -f "$DQ_FILE" ]; then
    python3 -c "
import json, sys
try:
    d = json.load(open('$DQ_FILE'))
    avg = d.get('avgScore', 0)
    n = len(d.get('recentScores', []))
    warned = d.get('warningInjected', False)
    status = 'WARNING' if warned else ('healthy' if avg >= 4.0 else 'fair')
    print(f'Decision quality: avg {avg}/6 ({n} cycles) — {status}')
except:
    print('Decision quality: no data')
" 2>/dev/null
else
    echo "Decision quality: no data"
fi
