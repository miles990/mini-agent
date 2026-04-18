# Ghost-commitment防線 — arrival watermark for web-fetch-results

**Date**: 2026-04-19
**Cycle**: post-#70 heartbeat
**Status**: proposal (awaiting Alex approval — self-modification of src/ under restricted-reminder)
**Task**: [2026-04-18T13:17:51.783Z] Ghost commitment = 承諾讀但下個 cycle 沒翻 web-fetch-results 直接做別的

## Problem (validated against code, not speculation)

`src/memory.ts:2359-2380` injects `memory/state/web-fetch-results.md` every cycle for 10 min TTL with a static footer:

```
[fetched Xmin ago — already in context, do NOT issue another <kuro:fetch> for the same URL]
```

Failure mode: cycle N says "I'll read this". Cycle N+1 sees an identical block with an identical "already in context" hint. No signal distinguishes "new arrival this cycle" from "you already said you'd handle this 3 cycles ago and didn't". Kuro drifts, the payload ages out, re-fetch loop starts.

## Evidence the design is right but incomplete

The TTL-not-one-shot comment (lines 2360-2363) correctly solved the earlier race. The remaining gap is **arrival-awareness**, orthogonal to TTL.

## Proposed change (≤ 25 LOC)

1. New file `memory/state/web-fetch-watermark.json` = `{ "lastProcessedMtime": <ms> }`
2. In the `!isLight` block (line 2364-2380), after reading `stat.mtimeMs`:
   - Load watermark (default 0)
   - Compute `cyclesSinceArrival = watermark.lastProcessedMtime === stat.mtimeMs ? (watermark.seenCount ?? 1) + 1 : 1`
   - If `cyclesSinceArrival === 1` → tag `[NEW — arrived this cycle, read it before other work]`
   - If `2..3` → tag `[seen ${n} cycles ago — if you committed to read, do it now]`
   - If `>= 4` → move payload to `<stale-fetch-warning>` section + force Kuro to explain or discard
3. Write updated watermark (mtime + seenCount)
4. On mtime change → reset seenCount to 1

## Why not edit now

System reminder restricts augmenting this file. Capturing as proposal for Alex / next L2-sanctioned cycle.

## Rollback

Delete the watermark file; block falls back to current TTL-only behavior.

## Metric of success

`memory/state/pulse-state.json` ghost-commitment counter (or analogous) drops by ≥50% over 50 cycles after deploy. If no such counter exists, add one as part of the same change.
