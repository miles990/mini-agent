# Dispatcher mark-done fix — Fix 3 (combined)

**Status**: spec-grade artifact, awaiting Alex apply (malware-guard blocks src/ patches by Kuro)
**Author**: Kuro (cl-30, 2026-04-30 00:08 +08)
**Anchor commit**: see HEAD of `mini-agent` at write time
**Replaces**: chat 215 spec (text-only) — this is the apply-ready version

---

## Problem (verified against source)

`mini-agent/src/loop.ts:2860-2890` dispatcher mark-done path has two silent-failure modes that cause scheduler to re-dispatch already-done tasks:

### Bug 1 — `:2872` swallows all errors

```ts
markTaskDoneByDescription(path.join(process.cwd(), 'memory'), filteredDones).catch(() => {});
```

`markTaskDoneByDescription` (memory-index.ts:1499-1542) does fuzzy match against
`queryMemoryIndexSync({type:['task','goal'], status:['pending','in_progress']})`.
On lookup miss it silently returns 0 (no throw). Even if it threw, `.catch(() => {})`
swallows. Cycle proceeds as if mark-done succeeded → scheduler re-dispatches next cycle.

This is the dispatcher-end of the same family as MEMORY note "task-queue silent no-op"
(2026-04-26): `updateMemoryIndexEntry` returning `false` on lookup-miss without raising.

### Bug 2 — `:2878` `currentTaskId` guard

```ts
const schedState = getSchedulerState();
if (schedState.currentTaskId) {
  schedulerTaskDone(schedState.currentTaskId);
  completeProcess(schedState.currentTaskId);
}
```

On continuation/yielded cycles `currentTaskId` is commonly `undefined`. mark-done
in the index succeeds, but `schedulerTaskDone` is never called → scheduler's
internal state still considers the task active → `selectNextTask` re-picks it.

### Bonus — `:2882-2887` poisons success-pattern DB

```ts
const { recordSuccessPattern } = await import('./success-patterns.js');
for (const done of filteredDones) {
  recordSuccessPattern(done, action ?? '', [...cycleTagsProcessed], this.currentMode);
}
```

This iterates all `filteredDones` regardless of whether mark-done actually matched.
If Bug 1 fires (no match), success-patterns DB records a "successful" mode/action
combination that didn't actually complete a task. Pollutes downstream learning.

---

## Fix 3 (combined) — change signature to return matched IDs

### Patch A — `src/memory-index.ts:1499-1542`

```diff
-export async function markTaskDoneByDescription(
-  memoryDir: string,
-  descriptions: string[],
-): Promise<number> {
-  let totalMarked = 0;
+/**
+ * Returns parallel array: for each input description, the matched & completed
+ * task ID (or null on miss). Caller can use this to drive scheduler updates
+ * without relying on `currentTaskId`.
+ */
+export async function markTaskDoneByDescription(
+  memoryDir: string,
+  descriptions: string[],
+): Promise<Array<{ description: string; taskId: string | null; summary?: string }>> {
+  const results: Array<{ description: string; taskId: string | null; summary?: string }> = [];

   for (const done of descriptions) {
     const doneNorm = done.toLowerCase().slice(0, 200);
     const tasks = queryMemoryIndexSync(memoryDir, {
       type: ['task', 'goal'],
       status: ['pending', 'in_progress'],
     });

     const matched = tasks.find(task => {
       /* ...unchanged matching logic... */
     });

     if (matched) {
       const updated = await updateMemoryIndexEntry(memoryDir, matched.id, { status: 'completed' });
       if (updated) {
         eventBus.emit('action:task', { content: updated.summary, entry: updated });
         if (updated.summary) await resolveActiveCommitments(memoryDir, updated.summary);
       }
       slog('DONE', `Marked task done: ${matched.summary?.slice(0, 60)}`);
-      totalMarked++;
+      results.push({ description: done, taskId: matched.id, summary: matched.summary });
+    } else {
+      // OBSERVABILITY: previously silent. Now logged so re-dispatch loops are diagnosable.
+      slog('DONE', `⛔ markTaskDoneByDescription: no match for "${done.slice(0, 80)}"`);
+      results.push({ description: done, taskId: null });
     }
   }

-  return totalMarked;
+  return results;
 }
```

### Patch B — `src/loop.ts:2871-2888`

```diff
         if (filteredDones.length > 0) {
-          markTaskDoneByDescription(path.join(process.cwd(), 'memory'), filteredDones).catch(() => {});
-          for (const done of filteredDones) {
-            markTaskProgressDone(done);
-          }
-          // Agent OS: notify scheduler + process table of task completion
-          const schedState = getSchedulerState();
-          if (schedState.currentTaskId) {
-            schedulerTaskDone(schedState.currentTaskId);
-            completeProcess(schedState.currentTaskId);
-          }
-          try {
-            const { recordSuccessPattern } = await import('./success-patterns.js');
-            for (const done of filteredDones) {
-              recordSuccessPattern(done, action ?? '', [...cycleTagsProcessed], this.currentMode);
-            }
-          } catch { /* fire-and-forget */ }
+          // Fix 3: await + use returned IDs to drive scheduler, instead of currentTaskId guard.
+          let markResults: Array<{ description: string; taskId: string | null; summary?: string }> = [];
+          try {
+            markResults = await markTaskDoneByDescription(
+              path.join(process.cwd(), 'memory'),
+              filteredDones,
+            );
+          } catch (err) {
+            slog('DONE', `⛔ markTaskDoneByDescription threw: ${(err as Error).message} for [${filteredDones.join(', ').slice(0, 200)}]`);
+          }
+
+          for (const done of filteredDones) {
+            markTaskProgressDone(done);
+          }
+
+          // Agent OS: notify scheduler + process table for EVERY successfully-marked task.
+          // Bypasses the `currentTaskId` guard (which is undefined on continuation cycles).
+          const successfullyMarked = markResults.filter(r => r.taskId !== null);
+          for (const r of successfullyMarked) {
+            schedulerTaskDone(r.taskId!);
+            completeProcess(r.taskId!);
+          }
+
+          // Fallback: if dispatcher had a currentTaskId but it wasn't covered by ID matches
+          // (e.g. fuzzy-match landed on a different task), still notify scheduler about it.
+          const schedState = getSchedulerState();
+          if (schedState.currentTaskId && !successfullyMarked.some(r => r.taskId === schedState.currentTaskId)) {
+            schedulerTaskDone(schedState.currentTaskId);
+            completeProcess(schedState.currentTaskId);
+          }
+
+          // Only record success-patterns for dones that ACTUALLY matched a task.
+          // Prevents pattern-DB pollution from no-op mark-dones.
+          try {
+            const { recordSuccessPattern } = await import('./success-patterns.js');
+            for (const r of successfullyMarked) {
+              recordSuccessPattern(r.description, action ?? '', [...cycleTagsProcessed], this.currentMode);
+            }
+          } catch { /* fire-and-forget */ }
         }
```

---

## Apply instructions

```bash
cd /Users/user/Workspace/mini-agent
# 1. Inspect current state at the two anchors
sed -n '1499,1545p' src/memory-index.ts
sed -n '2870,2890p' src/loop.ts

# 2. Apply Patch A and Patch B by hand (or extract diffs above into .patch and `git apply`).
# 3. Build & smoke-test
npm run build
# 4. Watch slog 'DONE' for one heartbeat — should now show either
#    "Marked task done: …" OR "⛔ markTaskDoneByDescription: no match for …"
#    (no more silent failures)
```

---

## Falsifier (5-cycle observation window)

After apply + restart, watch:
- `memory/state/scheduler.jsonl` (or wherever scheduler state lives) for tasks
  being re-selected after `schedulerTaskDone` was called.
- slog tail for `⛔ markTaskDoneByDescription: no match` lines.

**Refute Fix 3 if**: scheduler still re-dispatches a task that has a successful
`Marked task done: <id>` log line in the same cycle. → bug is in
`updateMemoryIndexEntry` / index rebuild, not dispatcher path.

**Confirm Fix 3 if**: every cycle either (a) emits a match-success log AND the
task disappears from scheduler queue, or (b) emits a no-match log (now visible
instead of silent) so the bug class becomes diagnosable.

---

## Risk

- **Low**. Single-caller signature change (verified by `grep markTaskDoneByDescription src/`
  → only `loop.ts:2872` consumes the return value, and current caller already discards
  it via `.catch(() => {})`).
- Behavior change for callers expecting `Promise<number>`: none exist outside the dispatcher.
- New slog lines may inflate log volume modestly during first few cycles after deploy
  (one extra line per failed match) — this is the desired observability.

---

## Why this artifact exists

malware-guard blocks Kuro from `Edit`/`Write` against `src/`. This file is a
**report describing a proposed diff** (allowed scope per CLAUDE.md guard
boundary, see rumination `malware-guard-actual-scope` 2026-04-29). Alex applies;
Kuro observes falsifier across the next 5 cycles.
