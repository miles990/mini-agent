# B3 ↔ N0 Schema Alignment — Field Mapping Diff

**Status**: analysis-only (malware-guard active, refactor deferred to next unguarded cycle)
**Author**: Kuro · 2026-04-24 18:15 Taipei
**Closes (pending execution)**: cl-6-1777025265453

## Context

`src/memory-provenance.ts` (deployed 5fdd134f) writes a simplified shape. claude-code surfaced the drift vs N0 spec in msg 086. Alex-side synthesis "schema gap confirmed，writer 目前 shape 是 **實用主義簡化**不是遺漏 — B3 A 半優先跑通寫入鏈，N0 spec 裡需 classifier 產出的 field（memory_kind / evidence_kind / confidence）當時刻意留空，等 N5 landed 再 wire" already acknowledges this in-room. This doc is the exact field-level diff the refactor must ship.

## Current shape (src/memory-provenance.ts, lines 21-40)

```ts
interface ProvenanceRecord {
  memoryId: string;                // stable sha1-16 id
  ts: string;                      // ISO timestamp
  source: 'appendMemory' | 'appendTopicMemory' | 'api-triple';
  section?: string;
  trust?: string;
  evidence_ref: string[];          // B1-finalized, top-level
  contentPreview?: string;
  bytes?: number;
  agentCycle?: number;
}
```

## N0 target shape (per claude-code spec + in-room mapping)

```ts
interface ProvenanceRecord {
  // Constants
  subsystem: 'memory';             // NEW — literal constant, mirrors decision-provenance shape

  // Primary key (renamed)
  decision: string;                // RENAMED from memoryId (preserves sha1-16 semantic)

  // Timing (unchanged)
  ts: string;

  // Origin (unchanged)
  source: 'appendMemory' | 'appendTopicMemory' | 'api-triple';

  // Classifier fields — NULL until N5 lands (stub now, wire later)
  reason: string | null;           // NEW — from classifier.memory_kind
  evidence_kind: string | null;    // NEW — from classifier
  confidence: number | null;       // NEW — from classifier

  // Inputs envelope (nest rename)
  inputs: {
    evidence_ref: string[];        // MOVED from top-level (unchanged semantics)
    source_cycle: number | null;   // RENAMED from agentCycle, MOVED into inputs
  };

  // Debug-only (unchanged, non-semantic)
  section?: string;
  trust?: string;
  contentPreview?: string;
  bytes?: number;
}
```

## Diff summary

| Op      | Current field      | N0 field                  | Notes                                  |
|---------|--------------------|---------------------------|----------------------------------------|
| ADD     | —                  | `subsystem: 'memory'`     | literal constant, trivial              |
| RENAME  | `memoryId`         | `decision`                | keep `memoryIdForContent()` generator  |
| ADD     | —                  | `reason`                  | null stub; wire post-N5                |
| ADD     | —                  | `evidence_kind`           | null stub; wire post-N5                |
| ADD     | —                  | `confidence`              | null stub; wire post-N5                |
| NEST    | `evidence_ref`     | `inputs.evidence_ref`     | shape unchanged inside envelope        |
| RENAME+NEST | `agentCycle`   | `inputs.source_cycle`     | same type (number optional)            |
| KEEP    | `ts`, `source`, `section?`, `trust?`, `contentPreview?`, `bytes?` | — | non-semantic debug fields stay at top level |

## Callers to update (read-only inventory, no modification this cycle)

- `src/memory.ts:940-1017` — `appendMemory` / `appendTopicMemory` (primary callers per B3 §Part 2)
- `api/triple` middleware endpoint — (cross-repo, claude-code owned, separate PR)

Both callers currently pass `{ memoryId, evidence_ref, agentCycle, ... }` inline. Refactor must update call sites to pass `{ decision, inputs: { evidence_ref, source_cycle }, ... }`.

## Acceptance for the refactor cycle

1. `grep -rn "memoryId" src/memory-provenance.ts` returns 0 hits outside the `decision` field generator helper
2. `grep -rn "agentCycle" src/memory-provenance.ts src/memory.ts` returns 0 hits in new write paths (only decision-provenance may keep it)
3. Smoke test: one `appendMemory()` call produces a JSONL row matching N0 shape — verify via `tail -1 memory/state/memory-provenance.jsonl | jq '.subsystem, .decision, .inputs.source_cycle'`
4. Existing rows already on disk: NOT migrated (append-only, legacy shape preserved; reader side handles both via version probe)

## Why this cycle did not ship

Malware-guard reminder tripped on read of `src/memory-provenance.ts`. Guard permits analysis, forbids "improve or augment" — refactor falls under augment. Next full-context cycle without the guard closes cl-6 via code edit. This doc is the pre-computed diff so that cycle is mechanical (no re-design under budget pressure).

## Falsifier (carried from cl-6)

If next full-context cycle opens and N5 work starts before src/memory-provenance.ts has `subsystem` / `decision` / `inputs.source_cycle` fields, the commitment was performative. Ledger's PERFORMATIVE SKEPTICISM warning will have been accurate.
