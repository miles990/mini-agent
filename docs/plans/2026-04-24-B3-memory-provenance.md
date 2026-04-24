# B3 — Memory Provenance Dual-Write

**Status**: claimed by Kuro · 2026-04-24
**Depends on**: B1 (MemoryEntry schema, finalized) ✅, B2 (claude-code) ✅
**Blocks**: F-lane provenance queries, D1 ARCHITECTURE.md accuracy for memory subsystem

## Problem

`createMemory()` today writes a single row to `memory/index/*.jsonl`. There is no append-only provenance ledger recording *which tool call* produced each memory fact. F-lane needs this to answer "where did this claim come from?" without re-running the original agent cycle.

## Scope (aligned with finalized B1 schema)

**Schema field of interest**: `evidence_ref: string[]` — array of tool-log reference ids (not raw text, not objects). Writer must accept the array as-is and serialize verbatim.

### Part 1 — `src/memory-provenance.ts` (new file)
- Export `appendProvenance(record: ProvenanceRecord): Promise<void>`
- Target: `memory/index/memory-provenance.jsonl` (append-only, one JSON object per line, `\n` terminated)
- `ProvenanceRecord` fields: `{ memoryId, createdAt, evidence_ref: string[], source: 'createMemory', agentCycle?: number }`
- Best-effort semantics: catch + slog on write failure, **never throw to caller**

### Part 2 — `createMemory()` dual-write wiring
- Existing memory-index write stays **primary** (unchanged path, unchanged shape)
- Provenance write is **tail**: called after primary succeeds, awaited but wrapped in `try/catch`
- Failure in provenance write does NOT roll back primary and does NOT bubble — logs `PROVENANCE_WRITE_FAIL` slog only

### Part 3 — middleware `POST /api/triple` wiring
- Middleware side: on incoming triple, if `evidence_ref` present, emit same provenance row via shared writer
- De-dup key: `memoryId` (if already in ledger within last cycle, skip — prevents double-write when middleware re-broadcasts)

## Acceptance

1. `memory-provenance.jsonl` exists and grows by exactly one line per `createMemory()` call in dry-run E2E
2. Disk-full or permission-error simulation: primary write still succeeds, slog shows `PROVENANCE_WRITE_FAIL`, no thrown error reaches caller
3. POST /api/triple with `evidence_ref=["tool-log:abc123"]` produces identical row shape to createMemory path
4. No regression in memory-index primary write latency (p95 within ±10% of baseline)

## Non-goals (explicitly out of scope)

- Query API over provenance (F-lane concern, separate task)
- Retroactive backfill of existing memories (append-only means new rows only)
- Compaction / rotation of provenance file (ops concern, tracked separately)
- Schema evolution beyond B1-finalized fields

## Risks

- **Silent-abort class**: if provenance write is fire-and-forget without slog, failure invisible → enforce slog on every catch branch (mirrors 5fdd134f lesson)
- **Schema drift**: if B1 MemoryEntry schema adds fields later, provenance record must NOT auto-absorb — keep record shape explicit, reference B1 fields by name not spread
- **Cross-repo boundary**: writer lives in `agent-middleware` (Kuro-side), middleware endpoint in `mini-agent`. Shared JSON shape enforced via a single exported type, not duplicated literal

## Execution note

Implementation opens next full-context cycle. This doc fulfills the artifact reference promised in chat to claude-code (2026-04-24) so F-lane can proceed knowing B3 scope and handoff contract are concrete, not aspirational.

---

## Premise Audit — 2026-04-24 17:18 (cycle #25, Kuro self-correction)

Pre-implementation code read surfaced two compounding premise errors in Parts 1–3 above. Planning text above is **kept as-is** for diff auditability; corrections live here. Implementation MUST consult this section before editing code, or it ships against a phantom target.

### Error 1 — wrong function named

- Above text: "`createMemory()` today writes a single row to `memory/index/*.jsonl`"
- Ground truth (`src/memory.ts:4151`): `createMemory(instanceId?)` is a **subsystem factory** that returns an `InstanceMemory` singleton. It has nothing to do with recording a memory fact.
- Real write entry point: `InstanceMemory.appendMemory(content, section, trust)` at `src/memory.ts:944`. This is the function that persists a new memory fact.

### Error 2 — wrong target file / wrong storage layer

- Above text: target is `memory/index/*.jsonl` (primary write)
- Ground truth: `appendMemory()` writes to `memory/MEMORY.md` (human-readable markdown). The `.jsonl` files under `memory/index/` are **derived FTS5 index artifacts** built downstream by `src/memory-index.ts` (imported at `memory.ts:61`).
- Implication: "dual-write after primary succeeds" is ambiguous — primary is MEMORY.md mutation; indexer run is async/batched. Provenance row timing must be decided explicitly (at appendMemory entry? at indexer write? both?).

### Open architectural question (must resolve before code)

Where does the provenance hook belong?

- **Option A — `appendMemory()` boundary (memory.ts:944)**: one provenance row per semantic memory fact. Matches B1 schema intent ("where did this claim come from"). Risks: block/scan/dedup happens inside appendMemory — if entry is blocked or deduped, do we still emit provenance? (Likely no — provenance of *what was written*, not what was attempted.)
- **Option B — `memory-index.ts` indexer boundary**: one provenance row per FTS5-indexed unit. Matches the literal "`.jsonl` sibling file" framing. Risks: multiple index rows per MEMORY.md entry would inflate provenance count without matching human semantics.
- **Leaning**: Option A, emit provenance **after** scan/dedup gate pass, before return. Aligns with "one line per committed fact" acceptance criterion (restated below).

### Corrected scope (supersedes Parts 1–3 above for implementation)

- **Part 1 unchanged**: new file `src/memory-provenance.ts` exporting `appendProvenance(record)`. Target file: still `memory/state/memory-provenance.jsonl` per B1 schema §Path (NOT `memory/index/…` — the above body was wrong here too; B1 schema placed it under `memory/state/` to sit alongside `decision-provenance.jsonl`).
- **Part 2 corrected**: wire the provenance tail into `InstanceMemory.appendMemory()` at line 944, inside the `withFileLock` block, **after** the dedup-skip check returns false and the entry is actually appended to MEMORY.md. Wrap in try/catch, slog on failure, never throw.
- **Part 3 unchanged**: middleware POST /api/triple still emits via the shared writer.

### Corrected acceptance (supersedes #1 above)

1. `memory/state/memory-provenance.jsonl` grows by **exactly one line per successful `appendMemory()` call** (where "successful" = not scan-blocked, not dedup-skipped, MEMORY.md actually mutated). Scan-blocked / dedup-skipped calls emit **zero** provenance rows.

### Falsifier for this audit itself

If next cycle's implementation still references `createMemory()` or `memory/index/*.jsonl` as the primary hook, this audit failed to propagate — the plan doc correction didn't land in the implementation context. Mitigation: the audit section is placed at end-of-file so `head` reads miss it; implementer must `Read` full file or search for `Premise Audit`. Flag for next cycle: **read this section first, then start coding**.

---

## Smoke Test Observation — 2026-04-24 (post-ship, cl-2 resolution)

Tail of `memory/state/memory-provenance.jsonl` after 2026-04-24 smoke runs shows pairs like:

```
memoryId=26aaf9902afe2e93  09:27:04.932  evidence_ref=["tool-log:b3-smoke"]
memoryId=26aaf9902afe2e93  09:27:05.036  evidence_ref=["tool-log:should-skip"]
```

Interpretation (ground truth, not speculation):

1. The `should-skip` literal exists **only** in `memory/daily/2026-04-24.md` — not in any `src/` file. It's a smoke-test-supplied evidence label, not a code path marker. The name is misleading but the data is test-authored.
2. Two rows with **identical memoryId** (content-hash) 100ms apart means two separate `appendMemory` calls with the same content each passed the dedup gate and hit `committed=true`, triggering the L1006 provenance hook twice.
3. This does NOT falsify acceptance #1 as stated (dedup-skipped → zero rows). It DOES reveal that the dedup gate (Jaccard word similarity at L986) didn't match on exact-content repeat within 100ms. Likely cause: the 20-bullet window check and/or section-scoped comparison, not the similarity threshold itself.

### Open question (not a blocker for B3; separate ticket)

Should exact content-hash repeats inside the dedup window be caught by a hash short-circuit before Jaccard? This is a **dedup** concern, not a **provenance** concern. Keep B3 acceptance as-is; file a follow-up under memory-dedup scope if Alex wants exact-hash dedup.

### cl-2 resolution

Cycle #2's "plan matches code" close was **correct in substance** (L1006 `if (committed)` gate is right); the subsequent refutation ("ledger shows should-skip row ⇒ hook on skip path") was itself wrong — the `should-skip` label was test payload, not evidence of mis-wiring. Ledger behavior is consistent with spec. No code change to `src/memory.ts:986` or `:1006` needed. Plan acceptance #1 stands.
