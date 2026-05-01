# Reply-Task Guard Cross-Cycle Re-Dispatch Loop

**Date**: 2026-04-29
**Severity**: P0 (scheduler infinite re-dispatch)
**File**: `src/loop.ts:2860-2870`
**Status**: Diagnosed — fix proposal documented, src patch deferred to Alex (malware-guard)

## Symptom

Scheduler keeps re-dispatching the same P0 task ("stack rank: P0 回覆結果", "研究 x.com — 閱讀分析") cycle after cycle. Past-successes show the work was completed (chat sent, KG position posted, topic memory written), but `<kuro:done>` never sticks.

## Mechanism (Cross-Cycle Guard Bug)

```ts
// loop.ts:2860-2870
const hasReply = tags.chats.length > 0;        // SAME-CYCLE only
const filteredDones = tags.dones.filter(d => {
  const isReplyTask = /回覆|reply/i.test(d);
  if (isReplyTask && !hasReply) {
    slog('DONE', `⛔ Blocked: "${d.slice(0, 60)}" — reply task requires <kuro:chat>`);
    return false;                              // → done dropped silently
  }
  return true;
});
```

**The trap**:
- Cycle N: receives task "回覆結果" → emits `<kuro:chat>` reply → no `<kuro:done>` yet (LLM forgot, or wanted to verify next cycle)
- Cycle N+1: scheduler re-dispatches same task (because N didn't emit done) → LLM emits `<kuro:done>` referencing cycle N's chat as artifact → BUT cycle N+1 has no fresh chat → **guard drops the done** → task stays open → scheduler re-dispatches forever

## Evidence

- `commitment-ledger.jsonl`: cl-12 (cycle=12 ttl=12) tracking same P1 "回覆結果" with falsifier "下個 cycle scheduler 仍派同 P1" — that falsifier has now triggered ≥3 times
- `task-events.jsonl`: zero `status:"completed"` entries for the recurring "回覆結果" task across all recent cycles, despite past-success chat artifacts confirming the work
- This cycle's `recent_conversations`: 14:06:48 emitted `<kuro:done>` for "研究 x.com" with chat artifact ref → next cycle still re-dispatches same task

## Why the Guard Was Added

Originally legitimate: prevented LLM from claiming "回覆 alex" tasks done without actually replying. The guard is correct in intent, wrong in scope (same-cycle only).

## Fix Proposals (ranked)

### Option A — Accept past-cycle chat (recommended)
Track a rolling window of last 3 cycles' chat emissions. `hasReply` = any chat in last 3 cycles whose timestamp post-dates the task's last `pending` event.

**Cost**: small state add (`recentChatCycles: Set<cycleNum>`), 3-line guard change.
**Risk**: low — still requires a real chat to have happened, just not necessarily this exact tick.

### Option B — Accept artifact reference
Allow `<kuro:done>` content matching `room \d{4}-\d{2}-\d{2}|memory/topics/.+\.md` to bypass the chat requirement.

**Cost**: 5-line regex addition.
**Risk**: medium — LLM could fabricate refs (mitigation: verify path exists on disk before accepting).

### Option C — Disable guard, rely on A-gate
The A-gate at 2841-2858 already requires CHAT/REMEMBER/CODE output in task-focused mode. Reply-task guard is redundant when A-gate is properly tuned.

**Cost**: delete 10 lines.
**Risk**: medium — A-gate doesn't specifically check the task title contains 回覆/reply, so a "回覆" task could pass A-gate via REMEMBER alone (no actual reply sent).

## Recommendation

**Option A**, because:
1. Preserves the original safety intent (real chat must exist)
2. Matches actual workflow (LLM often replies cycle N, confirms done cycle N+1 with verification)
3. Falsifier: if scheduler still re-dispatches after A is shipped → bug is in cycle window calculation, fix locally

## Falsifier for This Diagnosis

If next cycle emits `<kuro:done>` + `<kuro:chat>` simultaneously (this cycle's plan) AND the cycle after still re-dispatches "P0 回覆結果":
- The bug is **NOT** the cross-cycle reply guard
- Look at `markTaskDoneByDescription` (loop.ts:2872) — fuzzy-match by description may fail if scheduler dispatches via task-id while done references title text
- Check `memory-index.ts` for the lookup path

## What I Did This Cycle (within malware-guard)

1. Read source code to localize the bug (`loop.ts:2860-2870`)
2. Wrote this diagnosis (topic memory, not src edit)
3. Will emit `<kuro:done>` + `<kuro:chat>` in the same cycle to satisfy the guard's strict same-cycle requirement and break the loop for THIS instance
4. Deferred actual src patch to Alex (3 fix options ranked above)

## Cross-References

- `2026-04-29-done-agate-false-reject-diagnosis.md` — different guard (A-gate strip) at lines 2841-2858
- `2026-04-29-agate-chat-output-accept.md` — proposed A-gate widening; explicitly says reply-task guard "still catches the most common abuse" — that note was wrong about cross-cycle case
- `commitment-ledger.jsonl` cl-12 — falsifier tracking this exact loop
