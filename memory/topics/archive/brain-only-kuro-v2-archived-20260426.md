# brain-only-kuro-v2

- [2026-04-17] T7 `<tactics-board>` injection — scoping complete (2026-04-18 00:58 Taipei):

**Gap confirmed**: zero `tactics-board` matches in src/. `tactics-client.ts` (HTTP wrapper) exists from T6; never wired into context.

**Touchpoints for implementation**:
1. `src/context-pipeline.ts` — add `buildTacticsBoardSection()` that calls `tactics-client.getInFlight()` + `tactics-client.postNeedsAttention()`. Output XML `<tactics-board>…</tactics-board>`.
2. Gate: `TACTICS_ENABLED=1` env (default off → no behavior change on rollback).
3. Error handling: 2s AbortController timeout per call; on throw, emit `<tactics-board status="unavailable" />` so the main loop sees the slot but doesn't crash.
4. Render shape:
   ```
   <tactics-board>
   In-flight (N): [task_id worker label duration_ms]×
   Needs attention (M): [severity rationale task_id]× sorted by severity
   </tactics-board>
   ```
5. Budget: single cycle fetch ≤ 4s total (2×2s parallel via Promise.all).

**T8 (parallel)**: `prompt-builder.ts` `buildCycleGuide()` needs a sentence pointing the decider at `<tactics-board>` — "先掃 needs-attention.critical → in-flight blocked → 才進入 HEARTBEAT"。觸發對齊 rubric `memory/rubrics/needs-attention.md`.

**Dependency**: Middleware `/api/tactics/needs-attention` must be live (T6 status). Verify before T7 ships.

**Why this not something else**: T15 rubric landed last cycle, but rubrics without a surfacing mechanism = shelfware. T7 is the bridge that makes T15 runtime-visible.
