# Scheduler dispatch bugs — real findings 2026-04-30

## Evidence base
- 7505 valid events in `memory/state/task-events.jsonl`
- 1480 unique task ids
- Analysis: 2026-04-30T12:18 by Kuro (foreground cycle, real Bash)

## Bug 1: rapid-dup dispatch (race condition)
**1.8% (27/1480)** of tasks have ≥2 `pending` events with same id within <500ms.

Smoking-gun examples (priority change in 2–9ms):
- `idx-16aa9e9f` 2026-04-27T16:14:14.601Z → .610Z (9ms) priority 1→0
- `idx-8ed696e4` 2026-04-27T17:00:52.580Z → .582Z (2ms) priority 1→0
- `idx-78a9ef50` 2026-04-27T17:56:16.718Z → .720Z (2ms)

Pattern: ms-level gap + priority transition = priority-promotion path emits a NEW pending event
before dispatch loop's idempotency check sees the original. Two paths writing pending events
with no shared lock / dedup window.

Likely loci (need to read mini-agent/src/loop.ts + dispatcher):
- promoteTaskPriority(): `appendTaskEvent({status:'pending', priority:0})` after upgrade
- dispatchTask(): `appendTaskEvent({status:'pending', ...})` on schedule tick
- No check whether last event for this task_id is already same-status within <1s.

## Bug 2: inbox-synth task infinite re-dispatch (root cause of 37x)
`idx-8151e84a` (Alex chat msg `2026-04-30-023` "為何task scheduler會這樣"):
- 37 events total, 36 pending + 1 abandoned, span 49 minutes (03:07:26 → 03:56:33)
- gap min 2ms, **median 22.8s**, max 940s
- This is NOT primarily a race — it's `pending` re-emission every ~22s for 49min until auto-abandon

Mechanism (cross-ref MEMORY 2026-04-30T09:28Z):
- Inbox-synth tasks (Alex chat → P0) have no canonical task_id in any task store
- `<kuro:done id="...">` lookup returns false → silent no-op (dispatcher line 394 `if (!current) return false`)
- Scheduler keeps re-dispatching every ~22s because no `done` ever lands
- Auto-abandon at 49min is the only termination

This explains why retry-lane responses with `<kuro:done>` / `<kuro:task-queue op="delete">` tags
do nothing — the task was never in a store with a real id to match against.

## Fixes (proposed, NOT shipped)

**Fix A (Bug 1)** — dedup window in `appendTaskEvent`:
- Before append, scan last 5 events for same task_id; if last has status=='pending' AND ts < 500ms ago AND status==target_status → skip append, log dedup hit
- Trade-off: legitimate rapid promotion (priority 1→0 within 1s) becomes silent. OK because priority is on payload not on the dedup key — log priority change separately.

**Fix B (Bug 2)** — inbox-synth ack path:
- prompt-builder synthesizes P0 from un-acked Alex msgs → write canonical task_id INTO task-events.jsonl on first dispatch (status:pending, type:task, source:telegram, refs:[roomMsgId])
- `<kuro:done>` matches by task_id OR by `payload.roomMsgId` → ack works
- Alternative: `<kuro:inbox-ack ref="msg-XXX">` op as MEMORY 09:28Z proposed — but that requires prompt-builder to recognize this op AND remove the synth from next render

**Fix C (defensive)** — auto-abandon timeout from 49min → 5min for inbox-synth:
- Stops the 37-cycle bleeding even if A/B not landed
- One-line config change

## What I did NOT do this cycle
- ❌ Did not modify mini-agent/src/loop.ts (need read first to confirm hypothesis)
- ❌ Did not ship any fix
- ✅ Wrote this finding (real file, verifiable: `wc -l` will return >0)

## Next-cycle actions (priority order)
1. Read `mini-agent/src/loop.ts` lines around `appendTaskEvent` / `dispatchTask` / `promoteTaskPriority` — confirm two-path hypothesis
2. Implement Fix C first (config tweak, low risk)
3. Implement Fix A (dedup in appendTaskEvent) with unit test on 27 known rapid-dup ids
4. Fix B is structural — separate plan, needs prompt-builder changes too

## Verification commands (for future cycle)
```bash
# Re-count rapid-dup after fix
cd /Users/user/Workspace/mini-agent
python3 -c "
import json,collections
from datetime import datetime
def p(t): return datetime.fromisoformat(t.replace('Z','+00:00'))
by={}
[by.setdefault(e['id'],[]).append(e) for e in (json.loads(l) for l in open('memory/state/task-events.jsonl') if l.strip()) if 'id' in e]
n=sum(1 for evs in by.values() if any((p(evs[i]['ts'])-p(evs[i-1]['ts'])).total_seconds()<0.5 and evs[i]['status']==evs[i-1]['status']=='pending' for i in range(1,len(sorted(evs,key=lambda x:x['ts'])))))
print(f'{n}/{len(by)} = {100*n/len(by):.2f}%')
"
# Target: <0.5% post-Fix-A
```
