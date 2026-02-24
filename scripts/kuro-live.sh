#!/bin/bash
# kuro-live — 即時顯示 Kuro 的 Claude CLI 正在做什麼
#
# 每秒輪詢 /status，顯示 busy/idle 狀態、lastTool、lastText
#
# 用法：
#   bash scripts/kuro-live.sh
#   bash scripts/kuro-live.sh --url http://localhost:3001 --key YOUR_KEY --interval 2

PORT="${PORT:-3001}"
BASE_URL="http://localhost:${PORT}"
API_KEY="${MINI_AGENT_API_KEY:-}"
INTERVAL=1

while [ $# -gt 0 ]; do
  case "$1" in
    --url)      BASE_URL="$2"; shift ;;
    --key)      API_KEY="$2"; shift ;;
    --interval) INTERVAL="$2"; shift ;;
    *) echo "Usage: kuro-live [--url URL] [--key KEY] [--interval SECS]" >&2; exit 1 ;;
  esac
  shift
done

exec python3 -u - "$BASE_URL" "$API_KEY" "$INTERVAL" <<'PYEOF'
import sys, json, time, urllib.request, urllib.error, shutil, textwrap
from datetime import datetime

base_url, api_key, interval_s = sys.argv[1], sys.argv[2], float(sys.argv[3])

R='\033[0m'; B='\033[1m'; D='\033[2m'
UP='\033[A'; EL='\033[2K'
G='\033[38;5;82m'    # green  — busy
GR='\033[38;5;240m'  # grey   — idle
OR='\033[38;5;215m'  # orange — tool
CY='\033[38;5;45m'   # cyan
BL='\033[38;5;75m'   # blue   — numbers
WH='\033[38;5;252m'  # white  — text
DM='\033[38;5;238m'  # dim
YL='\033[38;5;214m'  # yellow — warn
PK='\033[38;5;141m'  # purple — text

SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
spin = 0


def fetch():
    req = urllib.request.Request(f"{base_url}/status")
    if api_key:
        req.add_header('x-api-key', api_key)
    try:
        with urllib.request.urlopen(req, timeout=3) as r:
            return json.loads(r.read())
    except Exception as e:
        return {'_error': str(e)}

def trunc(s, n):
    s = str(s).replace('\n', ' ')
    return s[:n] + '…' if len(s) > n else s

def wrap_text(s, width, max_lines=5):
    """Wrap text to width, return list of lines."""
    s = str(s).strip()
    if not s:
        return ['']
    result = []
    for para in s.split('\n'):
        para = para.strip()
        if para:
            result.extend(textwrap.wrap(para, max(width, 20)) or [para])
    if not result:
        return ['']
    if max_lines and len(result) > max_lines:
        result = result[:max_lines]
        if not result[-1].endswith('…'):
            result[-1] += ' …'
    return result

def bar(n, total, w=30):
    if not total:
        return '─' * w
    filled = round(n / total * w)
    return '█' * filled + '░' * (w - filled)

def render(s):
    global spin
    cols, _ = shutil.get_terminal_size((120, 30))
    W = cols - 4
    sp = SPIN[spin % len(SPIN)]; spin += 1
    lines = []

    if '_error' in s:
        lines.append(f"{YL}⚠  {s['_error']}{R}")
        return lines

    c    = s.get('claude', {})
    busy = c.get('busy', False)
    task = c.get('loop', {}).get('task')
    loop = s.get('loop', {})
    cyc  = loop.get('cycleCount', 0)
    next_at = loop.get('nextCycleAt', '')
    try:
        next_str = datetime.fromisoformat(next_at.replace('Z', '+00:00')).astimezone().strftime('%H:%M') if next_at else '—'
    except Exception:
        next_str = next_at[11:16] if len(next_at) >= 16 else '—'
    last_action = loop.get('lastAction') or '—'

    # separator
    sep = f"{DM}{'─' * (W + 2)}{R}"

    if busy and task:
        elapsed   = task.get('elapsed', 0)
        tool_n    = task.get('toolCalls', 0)
        last_tool = task.get('lastTool') or '—'
        last_text = task.get('lastText') or ''
        prompt    = task.get('prompt', '')

        m, sec = divmod(elapsed, 60)
        elapsed_str = f"{m}m{sec:02d}s" if m else f"{sec}s"

        # progress bar using tool calls as rough proxy (assume ~20 per cycle)
        pb = bar(min(tool_n, 20), 20, 20)

        lines.append(f"{G}{B}{sp} BUSY{R}  {DM}elapsed={R}{BL}{elapsed_str}{R}  {DM}tools={R}{BL}{tool_n}{R}  {DM}[{G}{pb}{DM}]{R}")
        lines.append(sep)
        PFXW = W - 12
        pl = wrap_text(prompt, PFXW, 4)
        lines.append(f"{DM}  prompt : {R}{WH}{pl[0]}{R}")
        for extra in pl[1:]:
            lines.append(f"{DM}           {R}{WH}{extra}{R}")
        lines.append(f"{DM}  tool   : {R}{OR}{trunc(last_tool, PFXW)}{R}")
        tl = wrap_text(last_text, PFXW, 4) if last_text else ['—']
        lines.append(f"{DM}  think  : {R}{PK}{tl[0]}{R}")
        for extra in tl[1:]:
            lines.append(f"{DM}           {R}{PK}{extra}{R}")
        lines.append(sep)
        lines.append(f"{DM}  cycle #{cyc}  next={next_str}{R}")
    else:
        lines.append(f"{GR}○ idle{R}  {DM}cycle={R}{BL}#{cyc}{R}  {DM}next={R}{BL}{next_str}{R}")
        lines.append(sep)
        al = wrap_text(last_action, W - 16, 3)
        lines.append(f"{DM}  last action : {R}{WH}{al[0]}{R}")
        for extra in al[1:]:
            lines.append(f"{DM}                {R}{WH}{extra}{R}")
        for _ in range(max(0, 2 - len(al))):
            lines.append(f"{DM}  —{R}")
        lines.append(sep)
        lines.append(f"{DM}  loop: {'running' if loop.get('running') else 'stopped'}  mode={loop.get('mode','?')}{R}")

    return lines

# Initial render
print(f"\n{B}kuro-live{R}  {DM}{base_url}/status  Ctrl-C to exit{R}")
print()
init_lines = render({})
for _ in init_lines:
    print()
prev_rows = len(init_lines)

try:
    while True:
        s = fetch()
        lines = render(s)
        new_rows = len(lines)

        # Move up prev_rows lines and overwrite
        sys.stdout.write(UP * prev_rows)
        for line in lines:
            sys.stdout.write(EL + line + '\n')
        # Clear leftover lines if content shrank
        for _ in range(max(0, prev_rows - new_rows)):
            sys.stdout.write(EL + '\n')
        sys.stdout.flush()

        prev_rows = max(new_rows, prev_rows)
        time.sleep(interval_s)
except KeyboardInterrupt:
    print(f"\n{D}stopped{R}")
PYEOF
