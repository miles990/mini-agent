# Queue Silent-Drop Observation — 2026-04-22

**Status**: Observation (not yet reproduced, not yet diagnosed)
**Author**: Kuro
**Trigger**: Cycle #54 noticed two tag emissions from the previous cycle absent from `<task-queue>` this cycle, while unrelated queue items were intact.

## Signal

- Cycle N: emitted ≥2 `<kuro:task>` (or equivalent) tags expected to persist to `memory/HEARTBEAT.md` / task queue.
- Cycle N+1: neither item surfaces in `<task-queue>`, `<pending-tasks>`, or `<next>` sections.
- Other queue items from earlier cycles still present → not a global wipe, not a truncation of the whole list.

This implies a **selective silent-drop** somewhere on the emission → parse → `addTask` → file-append path.

## Candidate Paths

Attack surface based on prior heartbeat-pollution-diagnosis-20260420:
1. `loop.ts:2244` — `<kuro:task>` parser entry.
2. `dispatcher.ts:972` — dispatcher-side task emission path.
3. `memory.addTask()` — known zero-validation append; could also fail silently on write error (fs error swallowed?).
4. Queue persistence layer (if any) separate from HEARTBEAT.md append.

Earlier heartbeat-pollution fix added **hard gates** (length / newline / tag-leak filters). Hypothesis: a legitimate task string is being rejected by one of those gates without logging, producing silent drop.

## Repro Plan (for when silent_exit P1 clears)

1. Grep `src/memory.ts` and `src/loop.ts` for every `return` / `continue` on the `addTask` / task-parse path — list all silent-reject points.
2. Add a single-line `console.warn` or append to `memory/state/task-events.jsonl` at each reject point with `reason` field.
3. Next occurrence surfaces the reason in one cycle.

## Why Not Fix Now

- ~~Silent_exit P1 (commit `67c40914`) still pending Alex apply-or-reject~~ → **landed 2026-04-22 14:03** (author miles990, `memory.ts`). That blocker is cleared.
- Remaining reason to wait: observation count is N=1 cycle. Need at least 1 more occurrence to confirm it's a pattern vs a one-off (e.g., context truncation on my end misreading the queue). Shipping a diagnostic slog before the second sighting is premature instrumentation.
- Also: malware-guard currently blocks L2 self-apply to src/ this session. Repro plan step 2 (add `console.warn` at reject points) requires src/ edit → stage it for a propose-to-Alex cycle, not self-ship.

## Convergence

Observation promotes to task when either:
- Same drop signature reproduced in a second cycle, OR
- Alex asks about it.

Else retire this note after 7 days with status `unreproduced`.
