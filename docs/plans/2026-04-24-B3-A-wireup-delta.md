# B3 A 半 MVP Wire-Up — Apply-Ready Delta

**Date**: 2026-04-24
**Cycle context**: malware-guard active → cannot apply src/ edits this cycle. This doc captures the exact diff so next unguarded cycle (or Alex) can apply verbatim.
**Closes**: cl-1 (claude-code chat commitment), cl-6 (refactor before N5), partial cl-7.
**Prereq verified**: `classifyContent(content, evidence_kind?)` exists in `src/memory-classifier.ts:166-191`, returns `{primary_kind, subclaims, confidence}` per N0 spec.

## Scope

Wire `classifyContent()` into `src/memory.ts` provenance tail so `reason` / `confidence` stop being hardcoded null. Single call-site: `memory.ts:1010` (only `appendProvenance` caller in the codebase — verified via `grep appendProvenance src/`).

`evidence_kind` stays null in MVP — callers of `appendMemory()` don't currently plumb an evidence hint, and `classifyContent()` accepts `evidence_kind?` only to propagate forward (it doesn't infer from content). Inference heuristic can land post-MVP when callers start tagging.

## Diff (memory.ts only)

### (1) Add import near existing memory-provenance import (line ~69)

```ts
// existing:
import { appendProvenance, memoryIdForContent } from './memory-provenance.js';
// add:
import { classifyContent } from './memory-classifier.js';
```

### (2) Replace the appendProvenance block at memory.ts:1005-1027

Current:
```ts
if (committed) {
  appendProvenance({
    subsystem: 'memory',
    decision: memoryIdForContent(content),
    ts: new Date().toISOString(),
    source: 'appendMemory',
    reason: null,
    evidence_kind: null,
    confidence: null,
    inputs: {
      evidence_ref,
      source_cycle: null,
    },
    section,
    trust,
    contentPreview: content.slice(0, 120),
    bytes: Buffer.byteLength(content, 'utf8'),
  });
}
```

Replacement:
```ts
if (committed) {
  const classified = classifyContent(content);
  // MVP confidence gate (cl-1 commitment): low-confidence classifications skip
  // provenance write rather than polluting the ledger with garbage `reason`.
  // Threshold 0.5 is provisional — revisit once ≥100 rows in the wild so the
  // distribution can inform a calibrated cutoff.
  const MIN_PROVENANCE_CONFIDENCE = 0.5;
  if (classified.confidence >= MIN_PROVENANCE_CONFIDENCE) {
    appendProvenance({
      subsystem: 'memory',
      decision: memoryIdForContent(content),
      ts: new Date().toISOString(),
      source: 'appendMemory',
      reason: classified.primary_kind,
      evidence_kind: null, // post-MVP: plumb from callers that know the source
      confidence: classified.confidence,
      inputs: {
        evidence_ref,
        source_cycle: null,
      },
      section,
      trust,
      contentPreview: content.slice(0, 120),
      bytes: Buffer.byteLength(content, 'utf8'),
    });
  } else {
    // Debug trace so we can see skip rate without spamming the ledger.
    slog?.('memory-provenance', 'PROVENANCE_SKIP_LOW_CONFIDENCE', {
      confidence: classified.confidence,
      primary_kind: classified.primary_kind,
      contentPreview: content.slice(0, 120),
    });
  }
}
```

Note: if `slog` is not already imported in memory.ts, either drop the skip log (silently skip) or add the import. **Check before applying** — don't introduce an unused-import lint failure.

## Falsifiers (how we know wire-up actually worked)

Apply, run any memory write (e.g. an `appendMemory` path in a smoke test), then:

- `tail -1 memory/state/memory-provenance.jsonl | jq '.reason'` → must be one of `descriptive | imperative | inference | commitment | observation`, NOT `null`.
- `tail -1 memory/state/memory-provenance.jsonl | jq '.confidence'` → must be a number in `[0.5, 1.0]`.
- Feed obvious commitment-style content ("下 cycle 會做 X") → `reason` must be `commitment` (triggers COMMITMENT_CUES in memory-classifier).
- Feed obvious observation-style content (`curl http=200 ...`) → `reason` must be `observation`.

If `reason` stays null after apply → import missing or gate returned false. Check `classified.confidence` in a debug run.

## What this does NOT do (explicit non-goals)

- No subclaim splitting at the writer. `classifyContent` returns `primary_kind` only — subclaim granularity waits for a consumer that needs it.
- No `evidence_kind` inference — that's a caller-side concern.
- No retroactive classification of existing rows. Backfill is a separate task if ever wanted.
- No `source_cycle` plumbing. Still null in MVP.

## Ledger updates

- cl-1 → keep this plan doc as the deliverable. Ship of the diff closes cl-1 as kept.
- cl-6 → partially served (the shape refactor is what's here). Fully closed on ship.
- cl-7 → unchanged (that was the no-op classification).

## Alignment re-verification (2026-04-24 18:35 Taipei, cycle pre-apply)

Re-checked against live src/ immediately before next apply window:

- `classifyContent` signature at `src/memory-classifier.ts:166-169` = `(content: string, evidence_kind?: EvidenceKind): ClassifiedContent` — matches plan verbatim.
- `appendProvenance({` call-site at `src/memory.ts:1010` (plan's "1005-1027" range is stale by ~3 lines; the `if (committed) {` wrapper is just above line 1010 — block is unambiguous).
- `slog` IS already imported at `src/memory.ts:24` via `import { diagLog, slog } from './utils.js';` — the plan's conditional "drop skip log if slog not imported" resolves to: **use the skip-log variant as written**, no unused-import risk.

Conclusion: plan is apply-ready verbatim. Skip re-verification on next apply cycle.

## Follow-up tasks (post-MVP, not blocking)

1. Plumb `evidence_kind` hint from known callers (perception writes = `observation`, plan commits = `commitment`).
2. Add `source_cycle` by threading cycle counter into `appendMemory()` signature.
3. Calibrate `MIN_PROVENANCE_CONFIDENCE` from real data after 100+ rows.
4. Add a unit test that feeds a fixed content string and asserts the resulting jsonl row shape.
