# ai-trend cron date-label off-by-one — root cause located

**Cycle**: 2026-04-28 ~02:00 Taipei
**Task**: P1 ai-trend cron date-label off-by-one (added 2026-04-27T17:58:26.781Z)
**Status**: read-only audit complete, fix proposed, not self-applied (malware-guard active)

## Evidence

State directory pattern (every cron entry labeled `today - 1`):
```
ls -la mini-agent/memory/state/hn-ai-trend/
2026-04-22.json  mtime Apr 23 02:48   # cron @ 02:48 Taipei → labeled previous day
2026-04-24.json  mtime Apr 25 01:30   # cron @ 01:30 Taipei → labeled previous day
2026-04-25.json  mtime Apr 26 01:30   # cron @ 01:30 Taipei → labeled previous day
2026-04-27.json  mtime Apr 28 01:36   # cron @ 01:36 Taipei → labeled previous day  ← today's bug
```

Pattern is **deterministic across 4 cron runs**, not a one-off. Hypothesis (a) `--since=24h` window-start used as filename = **falsified** (would not produce consistent off-by-one across all runs; would also vary with --since flag).

## Root cause: file:line

**File**: `/Users/user/Workspace/mini-agent/scripts/hn-ai-trend.mjs`
**Line 139**:
```js
const date = new Date().toISOString().slice(0, 10);
```

`Date.prototype.toISOString()` always returns UTC. At 01:30 Taipei = **17:30 UTC previous day**, `.slice(0, 10)` returns yesterday's `YYYY-MM-DD`.

Used at line 142:
```js
const outFile = outFlag || join(outDir, `${date}.json`);
```

Same bug also touches `run_at` field at line 145 (`new Date().toISOString()`) but that one is intentionally UTC for a timestamp field — only the **filename slice** is wrong.

## Proposed fix (one-line, Alex apply)

Replace L139:
```js
// Before (UTC — wrong for filename labeling):
const date = new Date().toISOString().slice(0, 10);

// After (Taipei local YYYY-MM-DD):
const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
```

`'en-CA'` locale formats as `YYYY-MM-DD` (Sweden's `'sv-SE'` works too). No dep change, no schema change, idempotent.

## Falsifier check (from task spec)

Original falsifier (P1 task line):
> falsifier: 04-29 01:30 後若 04-28.json 仍缺、新檔名為 04-28（覆寫今天的）= 假設 (b) 確認；若新檔名為 04-29 = 假設 (a)

This is a **post-fix** falsifier (verify after Alex applies the patch). With patch applied:
- 04-29 01:30 cron → produces `2026-04-29.json` (correct)
- Pre-patch behavior on 04-29 01:30 would have produced `2026-04-28.json` (overwriting today's gap)

## Side-effects to consider

1. **Backfill of 04-23 / 04-26 / 04-28**: structurally impossible per fetcher CLI (no `--date` override) — already documented in HEARTBEAT P1 task. The patch only fixes future runs.
2. **Existing files (04-21/04-22/04-24/04-25/04-27)** all have wrong labels (off-by-one). Renaming them would shift the perceived timeline — leave them OR rename in a single batch. **Recommendation**: leave them; renderer can show actual date semantics by reading `run_at` field if needed.
3. **`run_at` at line 145**: keep UTC (timestamps should be timezone-anchored). Only the filename label needs Taipei local.

## Why this is the right level

- Symptom-level fix (rename files) doesn't prevent recurrence.
- Mechanism-level fix (this patch) addresses the date computation directly.
- Constraint-level (don't allow `toISOString().slice(0,10)` for filename) — could be enforced via lint rule, but overkill for one script.

## Hand-off to Alex

One-line change at `mini-agent/scripts/hn-ai-trend.mjs:139`. After apply, falsifier check on 04-29 01:30 cron run.
