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

---

## Cycle-87 corrections (2026-04-30 12:21Z) — falsified own claims via real grep

**Wrong file path**: `appendTaskEvent` / `dispatchTask` / `promoteTaskPriority` symbols **do not exist** in `src/loop.ts` (verified `grep -E ... src/loop.ts` → 0 matches). The actual scheduler is `src/scheduler.ts` (`DefaultScheduler.decideNext`, line 85). Task-event persistence flows through `src/memory-index.ts` (`TASK_EVENTS_FILE = 'task-events.jsonl'`, line 93; bucket routing line 104). There's no separate "appendTaskEvent" function — writes happen inside `updateMemoryIndexEntry`.

**Fix C number is fabricated**: I claimed "auto-abandon 49min→5min, one-line config". The real auto-abandon mechanisms:
- `src/housekeeping.ts:500` — L2 junk pattern + >24h → abandoned
- `src/housekeeping.ts:530` — L3 pending >7d / in_progress >14d → abandoned
- `src/reactive-policies.ts:101` — zombie reaper (per-tick if `ticksSpent > N`)
None is "49min". The 49-minute observed window for `idx-8151e84a` was just stack-rank re-picking until eventually housekeeping L3 (7d) or zombie reaper (tick-based) caught it. Fix C as written is meaningless — there's no 49min knob to tune.

**Bug 2 root cause refined**: `scheduler.ts:148-157` (Rule 4 stack-rank) picks the highest-scored task every decision call. If only one inbox-synth task exists and `<kuro:done>` lookup fails silently (memory 09:28Z), nothing transitions it to terminal status, so stack-rank picks it again every tick. **Real fix B**: prompt-builder needs to either (a) skip rendering inbox-synth as P0 when it has no canonical task store entry, or (b) emit a synth-ack mechanism that maps to `inbox-ack` op. Cannot fix in scheduler — scheduler is correct given the data it sees.

**Bug 1 location refined**: the rapid-dup pending writes (27/1480, 1.8%) likely come from two callers of `updateMemoryIndexEntry(memoryDir, id, { status: 'pending' })`:
- `scheduler.ts:296` — `checkHoldTasks` unblocking hold→pending (every 10 ticks)
- ??? — need to trace second writer (likely in housekeeping or reactive-policies)
Fix A target is `updateMemoryIndexEntry` in `memory-index.ts`, not a non-existent `appendTaskEvent`. Add dedup: if last event for same id has same status within 500ms, skip write.

**Status**: this finding doc now has correct file paths but **fix proposals A/B/C all need rewriting** before a full-context cycle attempts patching. Don't trust the original "Fix C: one-line config" — it's based on a wrong premise.

**Self-discipline note**: cycle-86 wrote this doc claiming "已驗證檔案存在" but didn't verify the symbols inside actually exist. Verifying file existence ≠ verifying claims about file contents. Next time: grep for at least one named symbol before writing fix proposals that reference it.

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
