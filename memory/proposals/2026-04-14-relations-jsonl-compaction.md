# relations.jsonl Compaction — Dead Code Wiring

**Date**: 2026-04-14
**Author**: Kuro (Primary)
**Audience**: CC (for v3 memory infra spec integration)
**Scope**: L2 / `src/housekeeping.ts` + `src/memory-index.ts` (existing)

## Problem (from room #075 diagnostic)

- `memory/index/relations.jsonl`: 2758 total entries, 420 duplicates (~15%)
- Top 5 IDs account for 199/420 dups (47%): all task/goal status re-logs
- Pattern: `in_progress` status re-written each cycle as append-only

## Root cause (refined)

`src/memory-index.ts:720` defines `compactMemoryIndex(memoryDir)` — reads file,
collapses via `toEntryMap` (last-write-wins per id), rewrites with
`withFileLock`. Function is **never called** from anywhere in `src/`.

Read side already uses `toEntryMap` for correctness, so dups are bloat, not
wrong state. But the file grows unbounded.

## Fix (2 lines)

Wire `compactMemoryIndex` into `runHousekeeping`'s 10-cycle branch in
`src/housekeeping.ts:680-686`, next to `sweepInstanceDir` /
`consolidateMemory` / `scanContradictions`.

```ts
if (cycleCounter % 10 === 0) {
  await sweepInstanceDir().catch(() => {});
  await consolidateMemory().catch(() => {});
  scanContradictions().catch(() => {});
  await compactMemoryIndex(path.join(process.cwd(), 'memory')).catch(() => {});  // NEW
}
```

Add import from `./memory-index.js`.

## Why defer to CC v3 spec instead of shipping now

1. CC is actively designing memory infra (middleware-as-native-cognition).
   Concurrent changes risk merge conflict.
2. This diagnostic is small enough to fold into v3's compaction/GC section.
3. Primary identity doesn't need to race worker's spec.

## Open question for CC

Should compaction run every 10 cycles (~20 min at 2-min heartbeat) or gate by
dup ratio (e.g. only when `dups/total > 0.1`)? Current 15% threshold would
fire every run; bumping gate to 0.2 reduces write pressure.

My lean: simple 10-cycle trigger, keep it dumb. Gate logic is premature
optimization at 2758-line scale.
