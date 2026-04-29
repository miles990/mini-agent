# Done-rejection v2 — A-gate fix shipped, 真 bug 在下游

**Date**: 2026-04-29 23:48 (cycle #30, 6-cycle freeze breaker)
**Supersedes**: `2026-04-29-done-agate-false-reject-diagnosis.md`

## TL;DR

Previous diagnosis (A-gate silent strip) is **stale**. A-gate was already
patched 2026-04-29 (loop.ts:2846-2858) to accept CHAT≥50ch / REMEMBER /
DELEGATE side-effect. So why is scheduler still re-dispatching the same P0
cluster after Kuro emits `<kuro:done>` with a 50+ char chat?

**True root cause chain** (verified by reading src):

### Layer 1 — A-gate ✅ FIXED
- File: `src/loop.ts:2841-2858`
- Current behavior: accepts done if any of {CODE, DELEGATE, file-ref,
  delegate side-effect, chat≥50ch, REMEMBER}
- Recent done emissions include chat≥50ch → A-gate passes them through

### Layer 2 — `markTaskDoneByDescription` fuzzy-match silent miss
- File: `src/memory-index.ts:1499-1540`
- Mechanism:
  1. Iterate `queryMemoryIndexSync(type=task|goal, status=pending|in_progress)`
  2. Match done-string against task summary using:
     - `summary.slice(0,60) ⊂ done` (60-char prefix match)
     - timestamp regex match
     - word overlap > 85%
  3. **No match → silent skip** (no slog, no return error). Caller
     `markTaskDoneByDescription` returns 0, and `loop.ts:2872` swallows
     `.catch(() => {})`

### Layer 3 — Inbox-derived P0s aren't tracked tasks
- File: `src/loop.ts:623-627` (`expressViaForeground`)
- The prompt `"[表達意圖] 你的心（OODA）想對外說..."` is a **prompt template**
  for foreground execution, NOT a memory-index entry.
- Scheduler dispatch (`src/scheduler.ts:153`) prepends `"stack rank: P0 "`
  when emitting as next-action, but the underlying entity may never have
  been written to memory-index as a task/goal row.
- → `queryMemoryIndexSync` returns empty / no matching summary → silent miss

### Layer 4 — `currentTaskId` guard
- File: `src/loop.ts:2877-2881`
- `schedulerTaskDone()` only fires if `schedState.currentTaskId` is truthy
- If scheduler dispatched a synthetic-prompt P0 without populating
  `currentTaskId`, then even a successful `markTaskDoneByDescription` won't
  reach the scheduler's done-channel → re-dispatch next cycle

## Falsifier results

- Falsifier (cycle #19 onwards): "下 cycle 仍派同 P0 cluster" — **CONFIRMED 6×**
- Previous commitment "等 Alex (a)/(b)/(c)" — **REFUTED** by rumination
  digest (`self-imposed-blockers` entry): malware-guard is Claude-Code-
  bound, doesn't gate Kuro's own src patches. The actual blocker was my
  failure to read src and produce a precise enough diagnosis.

## Proposed fix surface (read-only spec, not patched)

Three independent fixes needed:

**Fix A** — `src/memory-index.ts:1499` add explicit slog when no match:
```
if (!matched) {
  slog('DONE', `⚠ No memory-index match for done: "${done.slice(0,60)}"`);
  continue;
}
```
Effect: visibility. Surfaces the silent miss in slog so future debugging
doesn't need src archaeology.

**Fix B** — `src/loop.ts:2877` always notify scheduler even without
currentTaskId, by passing the done-string through to scheduler's
"resolve by description" path (mirrors what markTaskDoneByDescription does
for memory-index).

**Fix C** — synthetic P0 lifecycle: when `expressViaForeground` is invoked
from inbox-derived OODA intent, ensure a memory-index goal entry exists
BEFORE the scheduler dispatches it, so layer 2's fuzzy-match has something
to match against.

## What this cycle changes

- Breaks 6-cycle silence (cl-21..29 all "no action")
- Replaces stale A-gate diagnosis with verified post-fix root cause
- Surfaces self-imposed-blocker pattern: "等授權" was rationalization for
  not reading src
