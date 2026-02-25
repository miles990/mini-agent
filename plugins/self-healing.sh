#!/bin/bash
# Self-Healing — 自動偵測+修復系統問題
# Category: heartbeat (30min refresh)
#
# Philosophy: detect → diagnose → attempt fix → verify → report
# Only repairs what's safe to repair automatically (idempotent actions)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
HEALED=0

# macOS-compatible timeout (GNU timeout not available by default)
_timeout() {
  local secs="$1"; shift
  perl -e 'alarm shift; exec @ARGV' "$secs" "$@" 2>/dev/null
}

FAILED=0
REPORT=""

heal_report() {
  local status="$1"
  local msg="$2"
  if [ "$status" = "HEALED" ]; then
    HEALED=$((HEALED + 1))
    REPORT="${REPORT}  ✅ HEALED: ${msg}\n"
  elif [ "$status" = "FAILED" ]; then
    FAILED=$((FAILED + 1))
    REPORT="${REPORT}  ❌ UNRESOLVED: ${msg}\n"
  fi
}

# --- Check 1: Docker ---
if command -v docker &>/dev/null; then
  if ! _timeout 3 docker info &>/dev/null 2>&1; then
    open -a Docker 2>/dev/null
    sleep 5
    if _timeout 3 docker info &>/dev/null 2>&1; then
      heal_report "HEALED" "Docker was unavailable → restarted Docker Desktop"
    else
      heal_report "FAILED" "Docker unavailable, auto-restart failed"
    fi
  fi
fi

# --- Check 2: Pinchtab (Browser Bridge) ---
PINCHTAB_PORT="${PINCHTAB_PORT:-9867}"
PINCHTAB_HEALTH=$(curl -sf --max-time 3 "localhost:${PINCHTAB_PORT}/health" 2>/dev/null || echo "")
if [ -z "$PINCHTAB_HEALTH" ]; then
  # Pinchtab not responding at all
  if [ -f "$PROJECT_DIR/scripts/pinchtab-setup.sh" ]; then
    bash "$PROJECT_DIR/scripts/pinchtab-setup.sh" start &>/dev/null
    sleep 3
    if curl -sf "localhost:${PINCHTAB_PORT}/health" &>/dev/null; then
      heal_report "HEALED" "Pinchtab was unavailable → auto-start restored"
    else
      heal_report "FAILED" "Pinchtab unavailable, auto-start could not restore"
    fi
  fi
elif echo "$PINCHTAB_HEALTH" | grep -q '"disconnected"'; then
  # Pinchtab running but CDP connection lost — restart to reconnect
  if [ -f "$PROJECT_DIR/scripts/pinchtab-setup.sh" ]; then
    bash "$PROJECT_DIR/scripts/pinchtab-setup.sh" restart &>/dev/null
    sleep 3
    NEW_HEALTH=$(curl -sf --max-time 3 "localhost:${PINCHTAB_PORT}/health" 2>/dev/null || echo "")
    if echo "$NEW_HEALTH" | grep -q '"ok"'; then
      heal_report "HEALED" "Pinchtab CDP was disconnected → restart restored"
    else
      heal_report "FAILED" "Pinchtab CDP disconnected, restart could not restore"
    fi
  fi
fi

# --- Check 3: Disk Usage ---
DISK_PCT=$(df -h / 2>/dev/null | awk 'NR==2{print $5}' | tr -d '%')
if [ -n "$DISK_PCT" ] && [ "$DISK_PCT" -gt 90 ] 2>/dev/null; then
  if command -v docker &>/dev/null && _timeout 3 docker info &>/dev/null 2>&1; then
    docker system prune -f &>/dev/null
    NEW_PCT=$(df -h / 2>/dev/null | awk 'NR==2{print $5}' | tr -d '%')
    heal_report "HEALED" "Disk was ${DISK_PCT}% → docker prune → now ${NEW_PCT}%"
  else
    heal_report "FAILED" "Disk at ${DISK_PCT}%, no auto-cleanup available"
  fi
fi

# --- Check 4: Critical Memory Files ---
for f in SOUL.md MEMORY.md HEARTBEAT.md; do
  if [ ! -f "$PROJECT_DIR/memory/$f" ]; then
    (cd "$PROJECT_DIR" && git checkout HEAD -- "memory/$f" 2>/dev/null)
    if [ -f "$PROJECT_DIR/memory/$f" ]; then
      heal_report "HEALED" "memory/$f was missing → restored from git"
    else
      heal_report "FAILED" "memory/$f missing and cannot restore from git"
    fi
  fi
done

# --- Check 5: Uncommitted Memory Changes (data loss risk) ---
if [ -d "$PROJECT_DIR/.git" ]; then
  DIRTY=$(cd "$PROJECT_DIR" && git status --short memory/ skills/ plugins/ 2>/dev/null | wc -l | tr -d ' ')
  if [ "$DIRTY" -gt 15 ]; then
    heal_report "FAILED" "${DIRTY} uncommitted changes in memory/skills/plugins — data loss risk"
  fi
fi

# --- Check 6: Server Health Endpoint ---
HEALTH=$(curl -sf localhost:${PORT:-3001}/health 2>/dev/null)
if [ $? -ne 0 ]; then
  heal_report "FAILED" "Health endpoint unreachable"
fi

# --- Check 7: Fetch Quality (cdp.jsonl analysis) ---
CDP_LOG="$HOME/.mini-agent/cdp.jsonl"
if [ -f "$CDP_LOG" ]; then
  # Check for domains with repeated content_restricted results
  RESTRICTED_DOMAINS=$(python3 -c "
import json, sys
from collections import defaultdict
counts = defaultdict(int)
try:
    lines = open('$CDP_LOG').readlines()[-50:]
    for line in lines:
        try:
            d = json.loads(line.strip())
            if d.get('result') == 'content_restricted':
                from urllib.parse import urlparse
                dom = urlparse(d.get('url', '')).netloc
                if dom: counts[dom] += 1
        except: pass
except: pass
problems = [f'{d}({c}x)' for d, c in counts.items() if c >= 2]
if problems: print(', '.join(problems))
" 2>/dev/null)
  if [ -n "$RESTRICTED_DOMAINS" ]; then
    heal_report "FAILED" "Fetch content restricted: $RESTRICTED_DOMAINS — run: bash scripts/pinchtab-fetch.sh repair"
  fi
fi

# --- Check 8: Learned Behavior Integrity ---
LEARNED_FILE="$HOME/.mini-agent/pinchtab-learned.jsonl"
if [ -f "$LEARNED_FILE" ]; then
  # Check for domains learned as "ok" in headless that might be wrong
  # (social media domains should NOT be "ok" in headless)
  BAD_LEARNED=$(python3 -c "
import json
seen = {}
try:
    for line in open('$LEARNED_FILE'):
        try:
            d = json.loads(line.strip())
            seen[d['domain']] = d
        except: pass
except: pass
social = ['facebook.com', 'instagram.com', 'threads.net']
bad = []
for dom, d in seen.items():
    if d.get('behavior') == 'ok' and d.get('mode') == 'headless':
        if any(s in dom for s in social):
            bad.append(dom)
if bad: print(', '.join(bad))
" 2>/dev/null)
  if [ -n "$BAD_LEARNED" ]; then
    # Auto-repair: mark as content_restricted
    for domain in $(echo "$BAD_LEARNED" | tr ',' '\n' | tr -d ' '); do
      python3 -c "
import json, datetime, sys
d = {'domain': sys.argv[1], 'behavior': 'content_restricted', 'mode': 'headless',
     'lastSeen': datetime.datetime.utcnow().isoformat() + 'Z'}
print(json.dumps(d))
" "$domain" >> "$LEARNED_FILE" 2>/dev/null
    done
    heal_report "HEALED" "Bad learned behaviors fixed: $BAD_LEARNED → content_restricted"
  fi
fi

# --- Check 9: System Health State File ---
HEALTH_FILE=$(ls -t "$HOME/.mini-agent/instances"/*/system-health.json 2>/dev/null | head -1)
if [ -f "$HEALTH_FILE" 2>/dev/null ]; then
  HEALTH_ISSUES=$(python3 -c "
import json
try:
    d = json.load(open('$HEALTH_FILE'))
    issues = []
    # Check perception timeouts
    for name, p in d.get('perceptions', {}).items():
        if p.get('emptyCount', 0) > 5:
            issues.append(f'{name}(empty:{p[\"emptyCount\"]})')
    # Check fetch restrictions
    rd = d.get('fetchHealth', {}).get('restrictedDomains', [])
    if rd:
        issues.append(f'restricted:{len(rd)} domains')
    if issues: print(', '.join(issues))
except: pass
" 2>/dev/null)
  if [ -n "$HEALTH_ISSUES" ]; then
    heal_report "FAILED" "System health issues: $HEALTH_ISSUES"
  fi
fi

# --- Check 10: Telegram Notification Queue ---
TG_QUEUE="$HOME/.mini-agent/telegram-queue.jsonl"
if [ -f "$TG_QUEUE" ]; then
  QUEUE_SIZE=$(wc -l < "$TG_QUEUE" | tr -d ' ')
  if [ "$QUEUE_SIZE" -gt 10 ]; then
    heal_report "FAILED" "Telegram queue backing up: ${QUEUE_SIZE} unsent notifications"
  fi
fi

# --- Write sense-alerts.json for environment-sense.sh ---
ALERTS_FILE="$HOME/.mini-agent/sense-alerts.json"
if [ "$HEALED" -gt 0 ]; then
  # Write healed alerts so environment-sense.sh can display them
  python3 -c "
import json, datetime, sys
alerts = []
try:
    alerts = json.load(open('$ALERTS_FILE'))
except: pass
# Keep only last hour
now = datetime.datetime.utcnow()
alerts = [a for a in alerts if (now - datetime.datetime.fromisoformat(a.get('ts','2000-01-01').replace('Z',''))).total_seconds() < 3600]
alerts.append({'type': 'self-healed', 'service': 'system', 'ts': now.isoformat() + 'Z', 'healed': $HEALED})
json.dump(alerts, open('$ALERTS_FILE', 'w'), indent=2)
" 2>/dev/null
fi

# --- Output ---
if [ "$HEALED" -gt 0 ] || [ "$FAILED" -gt 0 ]; then
  echo "Self-Healing: ${HEALED} healed, ${FAILED} unresolved"
  echo -e "$REPORT"
else
  echo "All systems healthy"
fi
