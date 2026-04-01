#!/bin/bash
# Self-Healing — 自動偵測+修復系統問題
# Category: heartbeat (30min refresh)
#
# Philosophy: detect → diagnose → attempt fix → verify → report
# Only repairs what's safe to repair automatically (idempotent actions)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
HEALED=0

# macOS-compatible timeout — background + kill (perl alarm can't kill docker)
_timeout() {
  local secs="$1"; shift
  "$@" &
  local pid=$!
  ( sleep "$secs"; kill "$pid" 2>/dev/null ) &
  local watchdog=$!
  wait "$pid" 2>/dev/null
  local ret=$?
  kill "$watchdog" 2>/dev/null
  wait "$watchdog" 2>/dev/null
  return $ret
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
  elif [ "$status" = "INFO" ]; then
    REPORT="${REPORT}  ℹ️  ${msg}\n"
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

# --- Check 2: Chrome CDP (Browser) ---
CDP_STATUS=$(_timeout 5 node "$PROJECT_DIR/scripts/cdp-fetch.mjs" status 2>/dev/null)
if [ $? -ne 0 ] || [ -z "$CDP_STATUS" ]; then
  heal_report "FAILED" "Chrome CDP not available on port ${CDP_PORT:-9222}"
fi

# --- Check 3: Disk Usage (df primary, APFS container fallback) ---
# df accounts for purgeable space on APFS; container-level includes snapshots/VM/purgeable
# which macOS reclaims on demand — using container data causes false alarms (96% vs actual 51%)
DISK_PCT=$(df -h / 2>/dev/null | awk 'NR==2{print $5}' | tr -d '%')
if [ -z "$DISK_PCT" ] && command -v diskutil &>/dev/null; then
  CINFO=$(diskutil info / 2>/dev/null)
  TOTAL_B=$(echo "$CINFO" | awk -F'[()]' '/Container Total Space/{print $2}' | awk '{print $1}')
  FREE_B=$(echo "$CINFO" | awk -F'[()]' '/Container Free Space/{print $2}' | awk '{print $1}')
  if [ -n "$TOTAL_B" ] && [ -n "$FREE_B" ] && [ "$TOTAL_B" -gt 0 ] 2>/dev/null; then
    DISK_PCT=$(( (TOTAL_B - FREE_B) * 100 / TOTAL_B ))
  fi
fi
if [ -n "$DISK_PCT" ] && [ "$DISK_PCT" -gt 90 ] 2>/dev/null; then
  if command -v docker &>/dev/null && _timeout 3 docker info &>/dev/null 2>&1; then
    docker system prune -f &>/dev/null
    NEW_PCT=$(df -h / 2>/dev/null | awk 'NR==2{print $5}' | tr -d '%')
    if [ -z "$NEW_PCT" ]; then
      NEW_CINFO=$(diskutil info / 2>/dev/null)
      NEW_TOTAL=$(echo "$NEW_CINFO" | awk -F'[()]' '/Container Total Space/{print $2}' | awk '{print $1}')
      NEW_FREE=$(echo "$NEW_CINFO" | awk -F'[()]' '/Container Free Space/{print $2}' | awk '{print $1}')
      if [ -n "$NEW_TOTAL" ] && [ -n "$NEW_FREE" ] && [ "$NEW_TOTAL" -gt 0 ] 2>/dev/null; then
        NEW_PCT=$(( (NEW_TOTAL - NEW_FREE) * 100 / NEW_TOTAL ))
      fi
    fi
    if [ -n "$NEW_PCT" ] && [ "$NEW_PCT" -lt "$DISK_PCT" ]; then
      heal_report "HEALED" "Disk was ${DISK_PCT}% → docker prune → now ${NEW_PCT}%"
    else
      heal_report "INFO" "Disk at ${DISK_PCT}% (docker prune had no effect — likely APFS snapshots)"
    fi
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

# --- Check 6: Puppeteer Chrome (TM video pipeline dependency) ---
PUPPETEER_CHROME="$HOME/.cache/puppeteer/chrome"
if [ -d "$HOME/Workspace/teaching-monster" ]; then
  if [ ! -d "$PUPPETEER_CHROME" ] || [ -z "$(ls -A "$PUPPETEER_CHROME" 2>/dev/null)" ]; then
    (cd "$HOME/Workspace/teaching-monster" && npx puppeteer browsers install chrome &>/dev/null)
    if [ -d "$PUPPETEER_CHROME" ] && [ -n "$(ls -A "$PUPPETEER_CHROME" 2>/dev/null)" ]; then
      heal_report "HEALED" "Puppeteer Chrome was missing → reinstalled"
    else
      heal_report "FAILED" "Puppeteer Chrome missing, auto-install failed"
    fi
  fi
fi

# --- Check 7: Server Health Endpoint ---
HEALTH=$(curl -sf --max-time 3 http://127.0.0.1:${PORT:-3001}/health 2>/dev/null)
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
    heal_report "FAILED" "Fetch content restricted: $RESTRICTED_DOMAINS — may need login: node scripts/cdp-fetch.mjs login <url>"
  fi
fi

# --- Check 8: DOM Doctor Stats (selector failures + healing) ---
CDP_LOG="$HOME/.mini-agent/cdp.jsonl"
if [ -f "$CDP_LOG" ]; then
  DOM_STATS=$(python3 -c "
import json, collections
failures = collections.Counter()
healed = collections.Counter()
try:
    lines = open('$CDP_LOG').readlines()[-500:]
    for line in lines:
        try:
            d = json.loads(line.strip())
            if d.get('op') in ('click-failed','type-failed'):
                failures[d.get('domain','?')] += 1
            s = d.get('strategy','')
            if s and s != 'original':
                healed[s] += 1
        except: pass
except: pass
parts = []
if failures: parts.append('failures: ' + ', '.join(f'{d}({c}x)' for d,c in failures.most_common(3)))
if healed: parts.append('healed: ' + ', '.join(f'{s}({c}x)' for s,c in healed.most_common(3)))
if parts: print(' | '.join(parts))
" 2>/dev/null)
  if [ -n "$DOM_STATS" ]; then
    heal_report "INFO" "DOM Doctor: $DOM_STATS"
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
