#!/bin/bash
# kuro-watch — 即時觀察 Kuro 正在做什麼
#
# 用法：
#   bash scripts/kuro-watch.sh          # 即時 tail（彩色）
#   bash scripts/kuro-watch.sh --today  # 輸出今天完整 log 後離開
#   bash scripts/kuro-watch.sh --last N # 顯示最近 N 條後離開
#
# 資料來源：~/.mini-agent/instances/{id}/logs/behavior/YYYY-MM-DD.jsonl

# ── ANSI colors ──
RESET='\033[0m'
BOLD='\033[1m'
DIM='\033[2m'
C_TIME='\033[38;5;240m'    # 深灰
C_ACTOR='\033[38;5;246m'   # 灰
C_START='\033[38;5;82m'    # 亮綠 — cycle start
C_END='\033[38;5;45m'      # 青 — cycle end
C_ACTION='\033[38;5;141m'  # 紫 — autonomous action
C_CHAT='\033[38;5;75m'     # 藍 — chat/room
C_CRON='\033[38;5;239m'    # 暗灰 — cron
C_METRICS='\033[38;5;237m' # 更暗 — metrics
C_ERROR='\033[38;5;196m'   # 紅 — error
C_WARN='\033[38;5;214m'    # 橙 — warn

# ── 自動偵測 instance dir ──
INSTANCE_DIR=""
if [ -n "$MINI_AGENT_INSTANCE" ]; then
  INSTANCE_DIR="$HOME/.mini-agent/instances/$MINI_AGENT_INSTANCE"
else
  # 找最近有 behavior log 的 instance
  INSTANCE_DIR=$(ls -td "$HOME/.mini-agent/instances"/*/logs/behavior/ 2>/dev/null \
    | while read -r d; do
        inst=$(dirname "$(dirname "$d")")
        [ -f "$inst/logs/behavior/$(date +%Y-%m-%d).jsonl" ] && echo "$inst" && break
      done)
fi

if [ -z "$INSTANCE_DIR" ] || [ ! -d "$INSTANCE_DIR" ]; then
  echo "kuro-watch: no active instance found" >&2
  exit 1
fi

BEHAVIOR_DIR="$INSTANCE_DIR/logs/behavior"
TODAY=$(date +%Y-%m-%d)
LOG_FILE="$BEHAVIOR_DIR/$TODAY.jsonl"

# ── Python formatter ──
FORMATTER=$(cat <<'PYEOF'
import sys, json, os
from datetime import datetime

RESET  = '\033[0m'
BOLD   = '\033[1m'
DIM    = '\033[2m'
C_TIME    = '\033[38;5;240m'
C_ACTOR   = '\033[38;5;246m'
C_START   = '\033[38;5;82m'
C_END     = '\033[38;5;45m'
C_ACTION  = '\033[38;5;141m'
C_CHAT    = '\033[38;5;75m'
C_CRON    = '\033[38;5;239m'
C_METRICS = '\033[38;5;237m'
C_ERROR   = '\033[38;5;196m'
C_WARN    = '\033[38;5;214m'
C_NORM    = '\033[38;5;252m'

def color_for(action):
    if 'cycle.start'  in action: return C_START
    if 'cycle.end'    in action: return C_END
    if 'metrics'      in action: return C_METRICS
    if 'autonomous'   in action: return C_ACTION
    if 'room.message' in action: return C_CHAT
    if 'telegram'     in action: return C_CHAT
    if 'cron'         in action: return C_CRON
    if 'error'        in action: return C_ERROR
    if 'warn'         in action: return C_WARN
    return C_NORM

def fmt(line):
    line = line.strip()
    if not line:
        return None
    try:
        e = json.loads(line)
    except:
        return DIM + line[:120] + RESET

    ts = e.get('timestamp', '')
    try:
        t = datetime.fromisoformat(ts.replace('Z', '+00:00')).astimezone().strftime('%H:%M:%S')
    except Exception:
        t = ts[11:19] if len(ts) >= 19 else ts
    d  = e.get('data', {})
    actor  = d.get('actor', '?')
    action = d.get('action', '?')
    detail = str(d.get('detail', ''))

    c = color_for(action)
    time_str   = f"{C_TIME}{t}{RESET}"
    actor_str  = f"{C_ACTOR}{actor:<9}{RESET}"
    action_str = f"{c}{action:<30}{RESET}"

    # Show full detail; multiline detail gets continuation lines
    # Indent = 2 + 8(time) + 2 + 9(actor) + 2 + 30(action) + 2 = 55 chars
    INDENT = ' ' * 55
    detail_lines = [l for l in detail.split('\n') if l.strip()]
    if not detail_lines:
        detail_lines = ['']

    first = f"  {time_str}  {actor_str}  {action_str}  {DIM}{detail_lines[0]}{RESET}"
    cont  = [f"{INDENT}{DIM}{dl}{RESET}" for dl in detail_lines[1:]]
    return '\n'.join([first] + cont)

for line in sys.stdin:
    out = fmt(line)
    if out:
        print(out, flush=True)
PYEOF
)

# ── Status header (from /status API if available) ──
show_header() {
  local port="${PORT:-3001}"
  echo -e "${BOLD}┌─ kuro-watch ─────────────────────────────────────────────────${RESET}"
  if STATUS=$(curl -sf "localhost:${port}/status" 2>/dev/null); then
    local busy cycle
    busy=$(echo "$STATUS" | python3 -c "import json,sys; s=json.load(sys.stdin); print('BUSY' if s.get('claude',{}).get('busy') else 'idle')" 2>/dev/null)
    cycle=$(echo "$STATUS" | python3 -c "import json,sys; s=json.load(sys.stdin); t=s.get('claude',{}).get('loop',{}).get('task'); print(t['prompt'][:60] if t else '')" 2>/dev/null)
    if [ "$busy" = "BUSY" ]; then
      echo -e "${BOLD}│  status: ${C_START}● BUSY${RESET}${BOLD}  ${DIM}${cycle}${RESET}"
    else
      echo -e "${BOLD}│  status: ${C_METRICS}○ idle${RESET}"
    fi
  fi
  echo -e "${BOLD}│  log:    ${DIM}${LOG_FILE}${RESET}"
  echo -e "${BOLD}└──────────────────────────────────────────────────────────────${RESET}"
  echo ""
}

# ── Modes ──
MODE="follow"
LAST_N=30

while [ $# -gt 0 ]; do
  case "$1" in
    --today) MODE="today" ;;
    --last)  MODE="last"; LAST_N="${2:-30}"; shift ;;
    *) echo "Usage: kuro-watch [--today | --last N]" >&2; exit 1 ;;
  esac
  shift
done

show_header

case "$MODE" in
  today)
    if [ -f "$LOG_FILE" ]; then
      cat "$LOG_FILE" | python3 -c "$FORMATTER"
    else
      echo "No log for today yet."
    fi
    ;;
  last)
    if [ -f "$LOG_FILE" ]; then
      tail -n "$LAST_N" "$LOG_FILE" | python3 -c "$FORMATTER"
    else
      echo "No log for today yet."
    fi
    ;;
  follow)
    # Show last 20 lines then follow
    echo -e "${DIM}  ── recent ──────────────────────────────────────────────────${RESET}"
    if [ -f "$LOG_FILE" ]; then
      tail -n 20 "$LOG_FILE" | python3 -c "$FORMATTER"
    fi
    echo -e "${DIM}  ── live ─────────────────────────────────────────────────────${RESET}"
    # tail -f, pipe through formatter line by line
    tail -f "$LOG_FILE" 2>/dev/null | python3 -u -c "$FORMATTER"
    ;;
esac
