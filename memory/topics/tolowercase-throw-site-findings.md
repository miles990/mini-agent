# toLowerCase undefined — throw site candidates (loop.runCycle, 72 累計)

**Cycle 90, 2026-04-26**. Closes commitment cl-89-1777135370446 (grep src/ for `.toLowerCase()` without `?.` guard).

## Method

```bash
grep -rn "\.toLowerCase()" src/ --include="*.ts" | grep -v "\.test\." | grep -v "?\.toLowerCase"
```

68 hits across 28 files. Filtered to **call sites reachable from `loop.runCycle`** where the receiver isn't statically guaranteed to be a string.

## Ranked candidates (highest → lowest confidence)

### 1. `src/loop.ts:2652` — `tags.schedule.next.trim().toLowerCase()` ⭐ TOP
- Inside `runCycle` directly (matches stack-trace `loop.runCycle`).
- Guard: `if (tags.schedule)` — but **`.next` is NOT null-checked**.
- Dispatcher path (`dispatcher.ts:667`) gates `schedule` on `attributes.next` being truthy → safe via that route.
- **Risk**: any alternative/legacy tag parser that sets `tags.schedule` without enforcing `.next` triggers `undefined.trim()` → reported as toLowerCase chain location by error normalizer.
- **Patch**: `const isNow = tags.schedule.next?.trim().toLowerCase() === 'now';`
  - Also harden `parseScheduleInterval(tags.schedule.next)` at line 2670 — same field.

### 2. `src/feedback-loops.ts:126` — `errorMsg.toLowerCase()` in `extractErrorSubtype`
- Public function called from error classification path (called inside runCycle's catch block).
- Typed `errorMsg: string`, but if a thrown value lacks `.message` → caller may pass `undefined` via `String(err)` returning `'undefined'` (safe) **or** via direct `err.message` access (unsafe).
- **Patch**: `const lower = (errorMsg ?? '').toLowerCase();`

### 3. `src/loop.ts:865` — `(item.from || '').toLowerCase()` ✅ ALREADY GUARDED
Skip.

### 4. `src/loop.ts:3149` — `text.toLowerCase()` in `normalizeAction(text: string)`
- Typed string, called only from `computeActionSimilarity(action: string)` line 3157.
- `action` originates from `lastAction` field — could be undefined at startup.
- **Patch**: `private normalizeAction(text: string | undefined | null): string[] { return (text ?? '')` ...

### 5. Lower-risk (run rarely or well-typed at all callers — defer)
- `feedback-loops.ts:280, 710, 954, 1068`
- `commitments.ts:74` (text param, called with constructed strings)
- `nutrient.ts:67-97`, `inbox-processor.ts:42-287`, `agent.ts:164,1418` (already `?? ''` guarded)
- `kg-retrieval.ts`, `kg-entity-search.ts`, `kg-entity-registry.ts` — KG path, not runCycle
- `memory-index.ts`, `search.ts`, `omlx-gate.ts`, `task-graph.ts` — receivers come from typed records or already `?? ''`-guarded

## Recommended single patch (≤5 lines, surgical)

```diff
--- src/loop.ts
@@ line 2652
-        const isNow = tags.schedule.next.trim().toLowerCase() === 'now';
+        const next = tags.schedule.next;
+        if (!next) { /* malformed schedule tag — ignore */ } else {
+        const isNow = next.trim().toLowerCase() === 'now';
         ...
+        }
@@ line 2670
-          const ms = parseScheduleInterval(tags.schedule.next);
+          const ms = parseScheduleInterval(next);

--- src/feedback-loops.ts
@@ line 126
-  const lower = errorMsg.toLowerCase();
+  const lower = (errorMsg ?? '').toLowerCase();
```

## Falsifier
If after applying the loop.ts:2652 + feedback-loops.ts:126 patch the error count over 7 days does NOT drop from 72-rate, throw site is elsewhere (likely dynamic property access or a transitive call I missed). Then need full stack trace from error-patterns.json (currently only message text logged).

## Next action handoff
- Hand to claude-code via chat-room: "Two-line patch in loop.ts:2652 + feedback-loops.ts:126, see this file."
- Or apply directly next cycle when malware-reminder context lifts.
