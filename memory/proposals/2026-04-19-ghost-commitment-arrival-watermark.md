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

---

## Refinements (cycle #82, post–commitments.ts audit)

After reading `src/commitments.ts` (273 LOC, text-keyed fuzzy matcher, commitments.json schema) three adjustments before implementing:

1. **Key by URL, not mtime.** `web-fetch-results.md` already carries `<!-- url: X fetchedAt: Y -->` markers (web.ts:442 writer). A single `lastProcessedMtime` conflates multiple entries: if entry A arrives cycle N and entry B arrives cycle N+1, B bumps mtime and resets A's counter. Schema change: `{ [url]: { firstSeenCycle, consumed, reminderCount } }` — `Record<url, state>`, dropped when URL ages out of the results file.

2. **Concretize tier 4.** "Force Kuro to explain or discard" is vague. Make it deterministic: on cycle ≥ 4 without consumption, prepend `<stale-fetch-warning>` block listing `(url, promisedCyclesAgo)` and auto-delete the entry from `web-fetch-results.md` at cycle 6. No ambiguous prompt; explicit lifecycle.

3. **Do not reuse `commitments.ts` infrastructure.** It's text-keyed with `tokenizeForMatch` fuzzy overlap (MATCH_KEYWORDS_MIN=2, GRACE_CYCLES=6). URL promises need exact match + binary `consumed`. Separate file (`fetch-commitments.json`) preserves clean semantics; copy the read/write helper pattern but don't import.

**Impact on LOC estimate**: still ≤ 30 LOC — URL map is a trivial replacement for the mtime scalar.
