# P1-d: delegation.ts Slimming Plan

**Status**: Phase A DONE (c51af867), Phase B blocked on P1-c1/c2  
**Author**: Kuro  
**Date**: 2026-04-16  
**Result**: 725 → 537 lines (Phase A target ~540 ✅) → Phase B target ~350 lines

## Context

delegation.ts completed edit-layer conversion (P1-d commits: 26ed39bc, 7d194410, 12833888, 41c1d6fb). All dispatch now routes through middleware `/plan`. File still carries:
- Forge slot management (belongs in own module per §Q2)
- Output summary helpers (generic, not delegation-specific)
- Two no-op functions (middleware owns lifecycle now)
- Poll loop (will be replaced when P1-c1/c2 lands)

## Current Structure (725 lines)

| Section | Lines | Range | Action |
|---------|-------|-------|--------|
| Imports | 12 | 1-27 | Simplify after extraction |
| Types (DelegationTask, TaskResult, etc.) | 47 | 32-78 | **Stay** (external surface) |
| Constants (CAPABILITY_TO_WORKER, TYPE_DEFAULTS) | 46 | 80-125 | **Stay** |
| Forge (forgeExec/Create/Yolo/Cleanup/Recover/Status) | 67 | 126-192 | **→ forge.ts** |
| Commitment bridge (§5) | 49 | 194-242 | **Stay** |
| Local result tracking (activeTasks, completedTasks) | 13 | 244-256 | **Stay** |
| Output summary helpers | 98 | 258-355 | **→ delegation-summary.ts** |
| spawnDelegation + dispatchAndPoll + finalizeTask | 165 | 357-547 | **Stay** (Phase A), simplify (Phase B) |
| convertAndDispatchAsPlan | 40 | 549-588 | **Stay** |
| External surface (getTaskResult, listTasks, etc.) | 70 | 590-659 | **Stay** |
| Lifecycle (killAll, cleanup, no-ops) | 57 | 661-717 | **Delete no-ops**, keep killAll+cleanup |
| sleep utility | 7 | 719-725 | **Stay** |

## Phase A: Extract + Delete (no dependency, executable now)

### A1: Create `src/forge.ts` (extract ~67 lines)

Move from delegation.ts:
- `FORGE_LITE_BUNDLED`, `FORGE_LITE_PLUGIN`, `FORGE_LITE` constants
- `NO_INSTALL_TYPES` set
- `forgeExec()`, `forgeCreate()`, `forgeYolo()`, `forgeCleanup()`, `forgeRecover()`, `forgeStatus()`
- `ForgeSlotStatus` type (or re-export from types.ts)

Update callers:
- `delegation.ts`: `import { forgeCreate, forgeYolo, forgeCleanup } from './forge.js'`
- `api.ts` L70: `import { forgeStatus } from './forge.js'` (currently from delegation)
- `loop.ts` L87: `import { forgeRecover } from './forge.js'` (currently from delegation)

### A2: Create `src/delegation-summary.ts` (extract ~98 lines)

Move from delegation.ts:
- `extractDelegationSummary()` (used by finalizeTask + external)
- `buildRecentDelegationSummary()` (used by convertAndDispatchAsPlan + external)
- `persistDelegationResult()` (used by finalizeTask)
- `writeLaneOutput()` (used by finalizeTask)
- `JOURNAL_MAX_ENTRIES` constant

Import into delegation.ts: `import { extractDelegationSummary, buildRecentDelegationSummary, persistDelegationResult, writeLaneOutput } from './delegation-summary.js'`

Re-export from delegation.ts for backward compatibility:
```ts
export { extractDelegationSummary, buildRecentDelegationSummary } from './delegation-summary.js';
```

### A3: Delete no-ops + update loop.ts

Delete from delegation.ts:
- `recoverStaleDelegations()` (L707-709) — no-op, comment says "middleware owns"
- `watchdogDelegations()` (L715-717) — no-op, comment says "middleware owns"

Update loop.ts:
- L87: remove `recoverStaleDelegations, watchdogDelegations` from import
- L1000: remove `recoverStaleDelegations()` call
- L2771: remove `watchdogDelegations()` call

### Phase A result: ~725 - 67 - 98 - 11 ≈ **549 lines**

## Phase B: Poll Loop Simplification (after P1-c1/c2)

When middleware exposes result callbacks or push notification:
- Replace `dispatchAndPoll` (~56 lines) with `dispatchAndSubscribe` (~15 lines)
- Remove `POLL_INTERVAL_MS` constant
- Remove `sleep()` utility

When middleware owns result persistence:
- Remove `persistDelegationResult` call from `finalizeTask`
- Remove `writeLaneOutput` call from `finalizeTask`
- Simplify `finalizeTask` (~85 lines → ~50 lines)

### Phase B result: ~549 - 56 + 15 - 7 - 30 ≈ **~470 lines**

## Phase C: Type Consolidation (optional)

Move `DelegationTask`, `TaskResult`, `VerifyResult`, `ForgeOutcome` to `types.ts` (they're already partially there — `DelegationTaskType` and `Provider` live in types.ts).

### Phase C result: ~470 - 47 ≈ **~423 lines**

## Merge Conflict Risk

CC is doing Phase 2b (brain-side acceptance check). Phase 2b touches middleware brain/plan-engine, NOT delegation.ts. Phase A extraction is safe to execute in parallel.

## Verification

After each phase: `npx tsc --noEmit && npm run build` must pass. No behavior change — pure structural refactor.
