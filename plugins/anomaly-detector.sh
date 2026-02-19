#!/bin/bash
# Anomaly Detector — Meta-cognitive watchdog
# Detects Kuro's own behavioral anomalies
# Category: heartbeat (30min refresh)

INSTANCE_DIR="${HOME}/.mini-agent/instances/default"
BEHAVIOR_LOG="${INSTANCE_DIR}/logs/behavior.jsonl"
SERVER_LOG="${INSTANCE_DIR}/logs/server.log"

# --- Check 1: Learn Stagnation (24h without any action) ---
LAST_ACTION=""
if [ -f "$BEHAVIOR_LOG" ]; then
  LAST_ACTION=$(tail -50 "$BEHAVIOR_LOG" 2>/dev/null | grep -o '"action":"[^"]*"' | tail -1 | sed 's/"action":"//;s/"//')
fi

if [ -z "$LAST_ACTION" ]; then
  # Check server.log for recent actions
  RECENT_ACTIONS=$(tail -200 "$SERVER_LOG" 2>/dev/null | grep -c '\[ACTION\]' 2>/dev/null || echo 0)
  if [ "$RECENT_ACTIONS" -eq 0 ]; then
    echo "ALERT: No actions detected in recent logs — possible stagnation"
  else
    echo "OK: ${RECENT_ACTIONS} recent actions in server.log"
  fi
else
  echo "Last action: ${LAST_ACTION:0:80}"
fi

# --- Check 2: Action Paralysis (same action repeated 3+) ---
if [ -f "$BEHAVIOR_LOG" ]; then
  RECENT_3=$(tail -10 "$BEHAVIOR_LOG" 2>/dev/null | grep -o '"action":"[^"]*"' | tail -3 | sed 's/"action":"//;s/"//' | sort -u | wc -l | tr -d ' ')
  if [ "$RECENT_3" = "1" ]; then
    REPEATED=$(tail -10 "$BEHAVIOR_LOG" 2>/dev/null | grep -o '"action":"[^"]*"' | tail -1 | sed 's/"action":"//;s/"//')
    echo "ALERT: Same action repeated 3+ times: ${REPEATED:0:60}"
  fi
fi

# --- Check 3: Error spike ---
if [ -f "$SERVER_LOG" ]; then
  RECENT_ERRORS=$(tail -100 "$SERVER_LOG" 2>/dev/null | grep -ci 'error\|fail\|crash' 2>/dev/null || echo 0)
  if [ "$RECENT_ERRORS" -gt 10 ]; then
    echo "ALERT: ${RECENT_ERRORS} errors in recent logs"
  fi
fi

echo "Status: OK"
