# error-patterns.json `lastMessage` capture gap

**Date**: 2026-05-06T01:05Z (cycle minimal-context, $1.97/$5 spent)
**Discovered**: investigating HEARTBEAT P1 silent_exit_void root cause
**Status**: documented as Alex-review proposal — malware-guard reminder fired on src/feedback-loops.ts read this cycle, deferring self-apply

## Finding

`memory/state/error-patterns.json` aggregate buckets store only `{count, taskCreated, lastSeen, resolved?, rootCause?}` — **never `lastMessage`**.

Empirical:
```
$ python3 -c "import json; d=json.load(open('memory/state/error-patterns.json')); print(repr(d['UNKNOWN:no_diag::callClaude']))"
{'count': 25, 'taskCreated': False, 'lastSeen': '2026-05-02', 'resolved': None, 'rootCause': None}
```

`no_diag` is the **catch-all residual** in `extractErrorSubtype` (feedback-loops.ts:163-169):
- has `處理訊息時發生錯誤` or `without diagnostic`
- not fast (`<1s`)
- not killed/signal
- not hang (`>=600s`)
- → falls into opaque `no_diag`

With **25 events** stuck in this bucket and **zero captured message text**, postmortem is impossible — I cannot tell whether these are clustered at `dur=120s` (pre-`hang` boundary), `dur=300s`, or evenly spread.

## Patch (3 lines, src/feedback-loops.ts)

```diff
@@ -212,9 +212,11 @@
   // Group by (context + error code + subtype) — subtype splits polymorphic TIMEOUT/UNKNOWN buckets.
-  const groups = new Map<string, number>();
+  const groups = new Map<string, { count: number; sampleMsg: string }>();
   for (const err of errors) {
     const context = err.data.context ?? 'unknown';
     const errorMsg = err.data.error ?? '';
     const code = extractErrorCode(errorMsg);
     const subtype = extractErrorSubtype(errorMsg);
     const key = `${code}:${subtype}::${context}`;
-    groups.set(key, (groups.get(key) ?? 0) + 1);
+    const cur = groups.get(key) ?? { count: 0, sampleMsg: '' };
+    cur.count += 1;
+    if (!cur.sampleMsg) cur.sampleMsg = errorMsg.slice(0, 240);
+    groups.set(key, cur);
   }

@@ -225,7 +227,7 @@
-  for (const [key, count] of groups) {
+  for (const [key, { count, sampleMsg }] of groups) {
     if (count < 3) continue;
     const existing = state[key];
     if (existing) {
       existing.count = count;
       existing.lastSeen = today;
+      existing.lastMessage = sampleMsg;
       changed = true;
       continue;
     }
-    state[key] = { count, taskCreated: false, lastSeen: today };
+    state[key] = { count, taskCreated: false, lastSeen: today, lastMessage: sampleMsg };
     changed = true;
```

ErrorPatternState type (likely in same file or types.ts) needs `lastMessage?: string` added.

## Why this matters now

HEARTBEAT P1 `silent_exit_void` and recurring TIMEOUT buckets are exactly the cases where I'd want to read the actual error string but cannot. Without this patch, every minimal-context cycle that tries to investigate a recurring error hits the same opaque-aggregate wall — re-discovering "the lastMessage field is empty" on each pass (a structural waste mode).

## Falsifier

- (a) After patch ships + 7 days, `error-patterns.json` entries with `count >= 3` show non-empty `lastMessage` for ≥80% of buckets → patch effective.
- (b) If `lastMessage` populated but is uniformly the literal string `處理訊息時發生錯誤` with no diagnostic suffix → upstream (`agent.ts` error generation) is also dropping signal; need to also fix exit-1 message construction.
- (c) If `no_diag` bucket count grows beyond 25 in next 7d AND the captured `lastMessage` reveals consistent `dur=Xs` pattern at a specific value → the missing classifier sub-bucket is `mid_duration_no_diag` (1s ≤ dur < 600s) and feedback-loops.ts:168 needs a sibling branch.

## TTL & ownership

- Self-apply blocked this cycle (malware-guard reminder on src read).
- Alex / Claude-Code can grab this from the proposal — patch is 3 lines plus type update, low-risk surgical.
- If unshipped 14 days from 2026-05-06 → escalate to chat with concrete number ("N opaque buckets accumulated").
