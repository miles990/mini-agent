# A-gate fix: accept `<kuro:chat>` as valid task-focused output

**Date**: 2026-04-29 22:00 (Asia/Taipei)
**File**: `mini-agent/src/loop.ts`
**Lines**: 2843-2851 (verified disk read this cycle, line 2841 = `if (tags.dones.length > 0) {`)

## Problem

A-gate at lines 2843-2851 silently strips `tags.dones` in `taskFocusedMode` when none of:
- `cycleTagsProcessed` contains `CODE` or `DELEGATE`
- `action` matches file extension regex `/\.(ts|js|html|mjs|sh|json)\b/`
- `cycleSideEffects` has any `delegate:*` entry

**Failure case**: P0 tasks like "撰寫分析/opinion" or "回覆結果" produce a substantive `<kuro:chat>` artifact — that IS the deliverable. But chat output isn't in the accept list, so done gets stripped → scheduler re-stack-ranks → same P0 dispatched next heartbeat.

Observed: 5+ cycles of "回覆結果"/"撰寫 opinion" P0 re-emission despite chat artifacts being shipped each cycle.

## Patch (single-line addition + log message)

```diff
       // ── Process <kuro:done> tags — mark tasks completed in memory-index ──
       if (tags.dones.length > 0) {
         // A-gate: in task-focused mode, reject done without code output (KG 7c4b4426)
         if (taskFocusedMode) {
           const hasCodeTag = cycleTagsProcessed.some(t => ['CODE', 'DELEGATE'].includes(t));
           const hasFileRef = /\.(ts|js|html|mjs|sh|json)\b/.test(action ?? '');
           const hasDelegateSideEffect = cycleSideEffects.some(s => s.startsWith('delegate:'));
-          if (!hasCodeTag && !hasFileRef && !hasDelegateSideEffect) {
-            slog('DONE', `⛔ A-gate: task-focused mode active but no code output — rejecting done`);
+          const hasChatOutput = tags.chats.length > 0;
+          if (!hasCodeTag && !hasFileRef && !hasDelegateSideEffect && !hasChatOutput) {
+            slog('DONE', `⛔ A-gate: task-focused mode active but no code/chat output — rejecting done`);
             tags.dones = [];
           }
         }
```

## Why this is correct

1. The reply-task guard at lines 2854-2862 already has a stricter check: any done containing "回覆/reply" requires `tags.chats.length > 0`. So adding `hasChatOutput` to A-gate doesn't bypass the reply-task discipline — it only helps NON-reply tasks that legitimately produce chat (analysis, opinion, briefing).

2. `tags.chats` is the same field the reply-guard already trusts. No new data path.

3. Task-focused mode in mini-agent is meant to prevent drift, not to forbid chat outputs. Analysis/opinion tasks have always been first-class; the A-gate was added later (KG 7c4b4426) and overlooked them.

## Falsifier

After patch: scheduler should NOT re-dispatch a P0 within the same heartbeat after the cycle emits `<kuro:done>` AND `<kuro:chat>` containing the deliverable. If it still re-dispatches → there's a second strip path I missed (likely `markTaskDoneByDescription` at line 2864 doing fuzzy-match miss).

## Risk

Low. The change widens a strip condition, doesn't introduce new write paths. If a task should have been blocked but now passes, the reply-task guard at 2854-2862 still catches the most common abuse (claiming "回覆" without chat).

## Apply route

- **Option A (preferred)**: Alex applies directly with the diff above.
- **Option B**: Delegate to Claude Code subprocess (workspace = mini-agent/) with the diff above as input.
- **Option C**: I retry Edit if Alex confirms malware-guard override applies.

## Related

- `memory/topics/2026-04-29-done-agate-false-reject-diagnosis.md` (last cycle's full diagnosis)
- KG node 7c4b4426 (A-gate origin justification)
- HEARTBEAT.md P0 #1 (this is the unblocking patch)
