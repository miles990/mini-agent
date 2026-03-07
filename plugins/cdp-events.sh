#!/bin/bash
# CDP Event-Driven Perception — reads cdp-events.jsonl and outputs recent browser activity
# stdout -> <cdp-events>...</cdp-events> in Agent context
# Designed to complement chrome-tabs.sh (polling) with event-driven awareness

EVENTS_FILE="${HOME}/.mini-agent/cdp-events.jsonl"

if [[ ! -f "$EVENTS_FILE" ]]; then
  echo "CDP events: no data (cdp-watch not running?)"
  exit 0
fi

# Check if cdp-watch is running; auto-start if not
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if pgrep -f "cdp-watch.mjs" > /dev/null 2>&1; then
  WATCHER="running"
else
  # Auto-start cdp-watch daemon if Chrome CDP is reachable
  if curl -sf --max-time 2 "http://localhost:${CDP_PORT:-9222}/json/version" > /dev/null 2>&1; then
    nohup node "$PROJECT_DIR/scripts/cdp-watch.mjs" --daemon > /dev/null 2>&1 &
    WATCHER="starting"
  else
    WATCHER="stopped (CDP offline)"
  fi
fi

# Get events from last 10 minutes (heredoc avoids bash quoting issues)
python3 - "$EVENTS_FILE" "$WATCHER" << 'PYEOF'
import json, sys
from datetime import datetime, timedelta, timezone

events_file = sys.argv[1]
watcher = sys.argv[2]
now = datetime.now(timezone.utc)
window = timedelta(minutes=10)

recent = []
try:
    with open(events_file) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                e = json.loads(line)
                ts = datetime.fromisoformat(e['ts'].replace('Z', '+00:00'))
                if now - ts < window:
                    recent.append(e)
            except:
                continue
except Exception as ex:
    print(f'CDP events: error reading ({ex})')
    sys.exit(0)

print(f'Watcher: {watcher}')

if not recent:
    print('No browser events in last 10min')
    sys.exit(0)

# Summarize by event type
nav_count = sum(1 for e in recent if e['event'] == 'navigated')
open_count = sum(1 for e in recent if e['event'] == 'tab-opened')
close_count = sum(1 for e in recent if e['event'] == 'tab-closed')

parts = []
if nav_count: parts.append(f'{nav_count} navigations')
if open_count: parts.append(f'{open_count} tabs opened')
if close_count: parts.append(f'{close_count} tabs closed')
print(f'Activity (10min): {", ".join(parts) if parts else "title updates only"}')

# Show last 5 meaningful events (navigated + tab-opened, skip title-updated)
meaningful = [e for e in recent if e['event'] in ('navigated', 'tab-opened', 'tab-closed')]
if not meaningful:
    meaningful = recent

for e in meaningful[-5:]:
    ts = e['ts'][11:19]
    evt = e['event']
    domain = e.get('domain', '')
    title = e.get('title', '')[:50]
    if evt == 'navigated':
        from_domain = e.get('fromDomain', '')
        print(f'  [{ts}] {from_domain} -> {domain}: {title}')
    elif evt == 'tab-opened':
        print(f'  [{ts}] + {domain}: {title}')
    elif evt == 'tab-closed':
        print(f'  [{ts}] - {domain}: {title}')
    else:
        print(f'  [{ts}] {evt}: {title}')
PYEOF
