# Prompt-size baseline & Fix D vs Fix E decision — 2026-05-05

## TL;DR
**Decision: defer both Fix D and Fix E.** 5-day baseline (3271 cycles) shows context size healthy:
- p50=25K, p95=32K, max=36.7K chars — well within Claude's 200K cap
- Full prompt observed via `[ctx-size]` slog: ~46.4K (focused mode, 4 samples)
- Every section already has a working cap; no runaway growth detected

Retire the stale HEARTBEAT entry "觀測 slog 加 prompt-size (loop.ts:2018)". The instrumentation it asks for already exists in two forms.

## Data sources (already in production, didn't need to build anything)
1. **Slog**: `loop.ts:2014` — `[LOOP] [ctx-size] cycle=N mode=X chars=Y tok≈Z` per cycle (committed 9abfb335 / 55e0a875)
2. **JSONL append**: `memory.ts:3634` writes `memory/context-checkpoints/YYYY-MM-DD.jsonl` per cycle with full per-section breakdown — **already had 5 days × 3271 cycles of data**

## Baseline (5 days, 3271 cycles)
```
contextLength: p50=24939 p95=31754 max=36657
  mode=focused (n=2730): p50=25067 p95=31469 max=36657
  mode=full    (n=70):   p50=31846 p95=31990 max=31998
  mode=light   (n=471):  p50=14672 p95=23679 max=29363
```

## Top sections by mean contribution
| Section | Mean | Max | Appearances |
|---|---|---|---|
| web-fetch-results | 5045 | 6074 | 33 |
| situation-report | 3995 | 6072 | 3116 |
| memory | 3631 | 4042 | 3271 |
| recent_conversations | 2115 | 4080 | 2668 |
| kg-context | 2063 | 2064 | 417 |
| chat-room-recent | 1960 | 8347 | 672 |
| memory-index | 1946 | 2031 | 2752 |
| heartbeat-active | 1936 | 2072 | 3271 |
| workspace | 1921 | 4292 | 3244 |

All caps holding. `chat-room-recent` max=8347 is the only outlier; that's a single bursty conversation, p95 likely far below.

## Fix D vs Fix E re-evaluation
- **Fix D** (defensive prompt clamp at agent.ts:1749 when budget<5K): triggers only when non-context exceeds cap. At max 36.7K context + ~10K non-context body → ~46.4K total → **never approaches the budget edge**. Fix D would never fire under current load. **Defer**.
- **Fix E** (move soul/heartbeat from prompt body → context, subject to trimming): architecturally cleaner but no urgency. The non-context body chunk is ~10K (= 46.4K full − ~36K context). Trimming it via Fix E saves at most 10K when context is also at p95. **Defer**, revisit if max prompt ever > 100K.
- **Real risk track stays**: the silent_exit_void cluster at 23-45K (per `topics/.archive/timeout-generic-diagnosis-20260420.md`) is *not* a prompt-size problem — it's a CLI session-dead pattern wearing the same mask. That track is still open separately.

## Falsifier
- If `awk -F, '{print $1}' memory/context-checkpoints/2026-05-{06,07,08}.jsonl` shows any contextLength > 80K → revisit Fix E urgency.
- If `[ctx-size]` slog reports `chars > 100000` ≥3 times in a 24hr window → trigger Fix D as emergency clamp.
- TTL 14 days; if no growth signal by 2026-05-19, this decision becomes the new default.
