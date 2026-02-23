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
if ! curl -sf "localhost:${PINCHTAB_PORT}/health" &>/dev/null; then
  if [ -f "$PROJECT_DIR/scripts/pinchtab-setup.sh" ]; then
    bash "$PROJECT_DIR/scripts/pinchtab-setup.sh" start &>/dev/null
    sleep 3
    if curl -sf "localhost:${PINCHTAB_PORT}/health" &>/dev/null; then
      heal_report "HEALED" "Pinchtab was unavailable → auto-start restored"
    else
      heal_report "FAILED" "Pinchtab unavailable, auto-start could not restore"
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

# --- Output ---
if [ "$HEALED" -gt 0 ] || [ "$FAILED" -gt 0 ]; then
  echo "Self-Healing: ${HEALED} healed, ${FAILED} unresolved"
  echo -e "$REPORT"
else
  echo "All systems healthy"
fi
