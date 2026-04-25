# KG Conflict Resolution Audit — 2026-04-17

**Scope**: 23 `conf-type-*` entries in `memory/index/conflicts.jsonl` × `memory/index/resolution-audit.jsonl`
**Triggered by**: Cycle #28 chat — 「audit 這 23 筆 R1-R5 自動判決的對錯率」

## TL;DR
Individual judgments are mostly defensible (≥18/23). The real problem is **storage-layer drift**: the two sources disagree with each other on rule label, winner, or both.

## Systemic bugs (storage-layer)

### Bug #1 — Winner mismatch between files (6/23 = 26%)
| conflict | conflicts.jsonl winner | audit.jsonl winner |
|---|---|---|
| conf-type-4 (CodeRLM) | *(missing)* | project |
| conf-type-9 (HEARTBEAT) | [artifact, code-symbol, concept] | artifact |
| conf-type-13 (mushi) | *(missing)* | project |
| conf-type-18 (perception-stream.ts) | artifact | code-symbol |
| conf-type-20 (self-evolution-foundations) | *(missing)* | concept |
| conf-type-22 (src/loop.ts) | artifact | code-symbol |

### Bug #2 — Rule label mismatch (7/23 = 30%)
| conflict | conflicts.jsonl rule | audit.jsonl rule |
|---|---|---|
| conf-type-3 | R5 | R4 |
| conf-type-4 | *(missing)* | R5 |
| conf-type-7 | R5 | R4 |
| conf-type-9 | R5 | R2 |
| conf-type-13 | *(missing)* | R8 |
| conf-type-20 | *(missing)* | R8 |
| conf-type-21 | MISC | R6 |

### Bug #3 — Two incompatible rubrics
- `conflicts.jsonl` uses R1–R5 + MISC
- `resolution-audit.jsonl` uses R1–R8
- R4 in audit ≈ R5 in conflicts (dual-role)
- R6, R7, R8 exist only in audit
- Nobody reconciled the rubrics before resolving

## Judgment-level audit

### Strong — 13/23
R2 (file with extension) — conf-type-5, 11, 15: correct, deterministic rule
R3 (PascalCase feature name → concept) — conf-type-1, 12, 14, 19: consistent application
R5 multi-type — conf-type-3 (claude=[tool,actor]), conf-type-7 (github-account=[artifact,actor]): legitimate dual-role
R8 (no backing artifact → concept) — conf-type-20 (self-evolution-foundations): solid reasoning
R6 (technical category) — conf-type-21 (semantic caching): correct

### Debatable — 6/23
**R1 "named X is decision" pattern (conf-type-2, 6, 8, 10, 17, 23)** — all 6 use identical boilerplate evidence: *"decision is primary (first declaration + reasoning); concept is abstract ref"*. This reads as rubber-stamp, not real reasoning. Problem: "File=Truth principle", "Identity over Logs principle", "Transparency over Isolation" are named **principles**, not named **decisions**. A principle is closer to concept than to decision. Classifying all as `decision` loses granularity and arguably misclassifies 3 of the 6.

### Weak/Wrong — 2/23 (my disagreement)
**conf-type-9 HEARTBEAT** — audit picks `artifact` only; conflicts picks `[artifact, code-symbol, concept]`. HEARTBEAT is genuinely all three in mini-agent: it's a section in memory (artifact), a system concept in architecture docs, and referenced as a symbol in code. conflicts.jsonl's multi-type is more faithful. **The two files disagree on this one — and audit is wrong.**

**conf-type-18/22 (.ts files)** — audit says `code-symbol`, conflicts says `artifact`. `.ts` files ARE artifacts containing code symbols. Calling them either one alone is incomplete. Probably should be `[artifact, code-symbol]`.

## Error-rate summary
- Storage consistency: **6/23 winner drift + 7/23 rule drift = ~30% drift** across the two files
- Individual judgments (picking the "best" from the two files):
  - Clearly correct: 13/23 (57%)
  - Debatable but defensible: 6/23 (26%) — the R1 principle-as-decision pattern
  - Clearly wrong in at least one file: 2–3/23 (~10%)

## Recommended fixes
1. **Reconcile rubrics**: R1–R8 is the richer set. Update conflicts.jsonl MISC→R6 and missing→R5/R8.
2. **Single-source-of-truth**: pick one file as canonical (audit.jsonl has more evidence); regenerate the other deterministically.
3. **Replace R1 boilerplate evidence** with entity-specific reasoning, or split R1 into R1a (named decision) vs R1b (named principle → concept).
4. **HEARTBEAT** and `.ts` files should be multi-type — re-run those 3 with R5 rule.

## Root cause (mechanism, traced cycle #31)
The 30% drift is structural, not judgment. Two independent code paths populate `winner`/`rule`:

- `scripts/kg-resolve-entity-types.ts:296,304-305` — `applyRules()` produces `res.rule` (R0–R6 family), written only into `entities-resolved.jsonl` and `resolution-audit.jsonl`. **Never writes back to `conflicts.jsonl`.**
- `scripts/kg-merge-basename-collision.ts:99` — emits `resolution_rule: 'R8-basename-merge'` for the basename merger only.
- `conflicts.jsonl`'s `resolution_winner` / `resolution_rule` / `resolution_note` fields were populated by a separate (one-shot or manual) pass using the R1–R5+MISC rubric, then never re-synced when the resolver script ran.

Two files disagree because **nothing copies the resolver's output back into `conflicts.jsonl`**, and the two were authored against different rubrics.

**Structural fix (preferred):** drop `resolution_winner` / `resolution_rule` / `resolution_note` from `conflicts.jsonl` entirely. Conflict file = "what's disputed", audit file = "what we decided". Single writer (`kg-resolve-entity-types.ts`), single source of truth. Keep a `status: resolved` flip in `conflicts.jsonl` after resolver runs, but no winner duplication.

**Tactical fix (if keeping dual storage):** extend `kg-resolve-entity-types.ts` to also write back `resolution_winner` + `resolution_rule` into `conflicts.jsonl` in the same pass — guarantees consistency at the cost of duplication.
