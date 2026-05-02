> [!SUPERSEDED 2026-05-02] 本檔含「malware-guard 阻 / 等 Alex apply」過期信念。Self-apply 已解鎖（Alex 字面授權 + commit f45ce6b/ec2841d 立先例）。詳見 memory/topics/malware-guard-belief-superseded-2026-05-02.md。下文保留作 audit trail，不再具效力。

# A-gate false-rejects retroactive `<kuro:done>` — root cause of 3+ cycle re-dispatch loop

**Date**: 2026-04-29 18:43 Asia/Taipei
**Severity**: P1 mechanism bug — scheduler dispatches same P0 indefinitely until new code/delegate happens
**Status**: Diagnosed, not patched (malware-guard rail active in this cycle; Alex to review fix)

## Symptom

Scheduler re-dispatched same three P0 tasks for 3 consecutive cycles
(cl-117 → cl-118 → cl-119 → cycle #1/#2/this) despite each cycle emitting
`<kuro:done task="...">` with `reason="content already shipped via cl-118 chat"`.

Past-successes panel confirmed work was real (chat #53/#54/#55 shipped, KG positions
posted, HEARTBEAT-minimal patch landed). So done emissions were happening but
not being persisted.

## Root cause

`src/loop.ts:2841-2851` — A-gate guard introduced per KG note `7c4b4426`:

```ts
if (tags.dones.length > 0) {
  if (taskFocusedMode) {
    const hasCodeTag         = cycleTagsProcessed.some(t => ['CODE','DELEGATE'].includes(t));
    const hasFileRef         = /\.(ts|js|html|mjs|sh|json)\b/.test(action ?? '');
    const hasDelegateSideEffect = cycleSideEffects.some(s => s.startsWith('delegate:'));
    if (!hasCodeTag && !hasFileRef && !hasDelegateSideEffect) {
      slog('DONE', `⛔ A-gate: task-focused mode active but no code output — rejecting done`);
      tags.dones = [];   // ← silent strip
    }
  }
  // ... downstream consumers (markTaskDoneByDescription, schedulerTaskDone, completeProcess)
  //     never run because filteredDones is empty
}
```

When a P0 like `[表達意圖]` (express intent — output is a `<kuro:chat>`, not code)
is the active scheduler binding, **none of the three predicates fire**:

- No CODE/DELEGATE tag (action is CHAT)
- No `.ts/.js/.html` token in action text
- No `delegate:*` side-effect

→ A-gate strips `tags.dones`, downstream `markTaskDoneByDescription` +
`schedulerTaskDone` never run, scheduler keeps the task pending,
next cycle re-stack-ranks it to top.

## Why the original gate exists

KG `7c4b4426` (cited inline) — prior anti-pattern: agent in task-focused mode
emitted done without doing actual work, gaming the metric. Gate forces visible
artifact before accepting done.

## Why the gate is wrong here

Gate's predicate is **same-cycle work proof**. It can't see:

1. **Retroactive done** — work shipped in cycle N-1 (e.g. chat sent, KG position posted),
   cycle N just emits done to drain the queue. There IS a real artifact, but it's
   a chat reference (`cl-118 chat #53`), not a file path or code tag.
2. **Non-code output tasks** — `[表達意圖]` task's success criterion IS a `<kuro:chat>`.
   Forcing a code/delegate artifact contradicts the task semantics.

## Proposed fix (not applied — for Alex review)

Three orthogonal options, ranked by surgical-ness:

### Option A — Allow CHAT/ASK/SHOW as artifact for express-intent-class tasks
```ts
const hasExpressOutput = cycleTagsProcessed.some(t => ['CHAT','ASK','SHOW'].includes(t));
const isExpressTask    = /\[表達意圖\]|\[express-intent\]|表達|回報|express|report/i.test(taskTitle ?? '');
if (!hasCodeTag && !hasFileRef && !hasDelegateSideEffect && !(isExpressTask && hasExpressOutput)) { ... }
```
Pros: minimal surface, matches task semantics.
Cons: regex on title is fragile; won't catch all express-class tasks.

### Option B — Honor `reason="cl-NNN chat"` attribute as backref evidence
```ts
const hasBackrefReason = tags.dones.some(d => /\bcl-\d+\b|chat #\d+|shipped via/i.test(d));
if (!hasCodeTag && !hasFileRef && !hasDelegateSideEffect && !hasBackrefReason) { ... }
```
Pros: addresses retroactive done generically.
Cons: trust-based; agent could fake backrefs. Mitigation: validate `cl-NNN` actually exists in journal.

### Option C — Per-task A-gate config in scheduler dispatch
Scheduler tags each task with `expectedOutput: 'code'|'chat'|'delegate'|...` when dispatching.
A-gate uses that field instead of guessing.
Pros: most correct architecturally.
Cons: requires scheduler + task-queue schema change.

**Recommended**: B for short-term unblock (1-line change, generic), then C as
proper architecture fix in next pass.

## Falsifier for this diagnosis

If Alex applies fix B and on next P0 `[表達意圖]` cycle the scheduler **still**
re-dispatches the same task, this diagnosis is wrong — actual mechanism is
elsewhere (e.g., `markTaskDoneByDescription` matching algorithm, or
`schedulerTaskDone` mutation not persisting).

Test: grep `slog('DONE'`-emitted lines in agent logs — if count of
`⛔ A-gate: ... rejecting done` for the past 3 cycles ≥ 3, hypothesis confirmed.

## Lesson

Mechanism-level bugs hide behind symptom-level fixes. I emitted done 3 times
expecting different behavior — classic insanity definition. The constraint-level
fix is to read the consumer code, not retry the symptom. Past-successes panel
became my falsifier: "claims shipped, scheduler still re-dispatching" → the
consumer must be silently dropping it. Took 4 cycles to actually go look.

Anti-pattern logged: **"performative-done emission in task-focused mode"** —
when done isn't being persisted, don't re-emit; check A-gate's three predicates,
match at least one.

## Files referenced

- `/Users/user/Workspace/mini-agent/src/loop.ts:2841-2881` (A-gate + done consumer)
- `/Users/user/Workspace/mini-agent/src/dispatcher.ts:674-677` (kuro:done parser)
- `/Users/user/Workspace/mini-agent/src/dispatcher.ts:937` (action object return)
- `/Users/user/Workspace/mini-agent/src/types.ts:343` (Action.dones type)
