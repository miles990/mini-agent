#!/bin/bash
# Skeptic Perception — 自我懷疑感知
# Category: heartbeat (30min refresh)
#
# 審視 Kuro 最近的推理品質，作為感知信號注入 OODA context。
# 不是命令「要懷疑」，而是讓 Kuro 看見自己的推理模式。

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Read challenge compliance from feedback loop state
INSTANCE_DIR=$(ls -td "$HOME/.mini-agent/instances"/*/ 2>/dev/null | head -1)
if [ -z "$INSTANCE_DIR" ]; then
  echo "No skeptic data yet"
  exit 0
fi

QUALITY_FILE="$INSTANCE_DIR/decision-quality.json"
if [ ! -f "$QUALITY_FILE" ]; then
  echo "No quality tracking data yet"
  exit 0
fi

# Extract challenge stats
CHALLENGE_STATS=$(python3 -c "
import json, sys
try:
    d = json.load(open('$QUALITY_FILE'))
    total = d.get('challengeTotal', 0)
    compliant = d.get('challengeCompliant', 0)
    avg_score = d.get('avgScore', 0)
    if total == 0:
        print('No Alex-facing responses tracked yet')
    else:
        rate = round(compliant / total * 100)
        print(f'Self-challenge: {compliant}/{total} ({rate}%) | Decision quality: {avg_score}/6')
        if rate < 50 and total >= 3:
            print('⚠️ Challenge rate low — 回覆 Alex 前記得做三個檢查：來源廣度、根因vs症狀、反例搜尋')
        if avg_score < 3.0:
            print('⚠️ Decision quality declining — 放慢節奏，每個決策寫 Why + Verified')
except Exception as e:
    print(f'Error reading quality data: {e}')
" 2>/dev/null)

# Check for challenge warning flag
CHALLENGE_FLAG="$INSTANCE_DIR/challenge-warning.flag"
if [ -f "$CHALLENGE_FLAG" ]; then
  CHALLENGE_WARNING=$(cat "$CHALLENGE_FLAG")
  echo "$CHALLENGE_WARNING"
  echo ""
fi

echo "$CHALLENGE_STATS"

# Check recent behavior log for reasoning patterns
BEHAVIOR_LOG=$(ls -t "$INSTANCE_DIR"/behavior-*.jsonl 2>/dev/null | head -1)
if [ -f "$BEHAVIOR_LOG" ]; then
  # Count recent Alex-facing cycles with/without verification markers
  RECENT_PATTERN=$(python3 -c "
import json
try:
    lines = open('$BEHAVIOR_LOG').readlines()[-20:]
    shallow = 0
    for line in lines:
        try:
            d = json.loads(line.strip())
            detail = d.get('detail', '')
            # Detect shallow patterns: single-source conclusions
            if 'telegram-user' in d.get('action', '') and detail:
                if 'Challenge' not in detail and '[CHAT]' in detail:
                    shallow += 1
        except: pass
    if shallow > 0:
        print(f'Recent pattern: {shallow} Alex responses without self-challenge in last 20 actions')
except: pass
" 2>/dev/null)
  if [ -n "$RECENT_PATTERN" ]; then
    echo "$RECENT_PATTERN"
  fi
fi
