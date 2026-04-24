# buildcontext-section-telemetry

- [2026-04-23] 2026-04-24 07:55 Taipei. Falsifier refuted "sectionChars instrumentation missing" premise.

**Truth**: `src/memory.ts:3352-3366` (saveContextCheckpoint) already emits per-section chars to `memory/context-checkpoints/YYYY-MM-DD.jsonl`. 7 days of data present (04-17 through 04-23).

**Previous diagnosis 2026-04-23 report** grepped `cycle-nutrient.jsonl` which only carries total contextChars — data existence assumption mistake, same class as 2026-04-22 learned pattern (Step 0 baseline task skippin
- [2026-04-23] [2026-04-24] Step 0 baseline done (`memory/reports/2026-04-24-buildcontext-section-tier-baseline.md`). 7 days / 3295 samples. Total context mean=20,606 / max=263,875. T1 HOT (≥3K mean, 56% of context): reasoning-continuity, task-queue, web-fetch-results, heartbeat, chat-room-recent, middleware-workers, memory. **Biggest finding: `heartbeat` section vol=66.71 max=258K — single cycle explosion caused the 263K context outlier. This is a mechanism bug (something pulling 60× normal content into one s
