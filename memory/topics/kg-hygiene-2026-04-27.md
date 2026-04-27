# KG Hygiene — 2026-04-27

## Action
P2 KG hygiene cycle: invalidated 38 false-positive CONFLICTS_WITH edges in `middleware` namespace.

## Findings
- Total CONFLICTS_WITH edges (active before): **47**
- Distribution: 38 middleware / 7 shared / 1 kg-architecture / 1 kuro
- 38 middleware edges all created same minute (2026-04-22T06:31:51) → systematic write-bug:
  - relation column = `CONFLICTS_WITH`
  - description text says `produced_finding` (correct semantic — sibling findings about same draft)
  - These are sibling findings about a single blog draft, NOT contradictions. Write-path mislabeled them.

## Mechanism
Atomic sqlite3 transaction on `/Users/user/Workspace/knowledge-graph/knowledge-graph.db`:
1. `UPDATE edges SET valid_until=ts WHERE id IN (38 ids) AND valid_until IS NULL`
2. 38× `INSERT INTO events (type='invalidate_edge', ...)` with reason logged
3. COMMIT

Audit trail preserved (38 invalidate_edge events in event log with kuro source_agent + reason).

## Result
- Active conflicts: **47 → 9** (81% reduction)
- Remaining 9 to triage (next cycle):
  - #1 (kuro/decision): legit semantic conflict — "Execution Plan: 2-3 cycle 動線" vs "kuro-site AI Trend Digest + KG Product" both PART_OF parents. Probably both valid (multi-parent OK). Decide canonicalization or invalidate one edge.
  - #2-5 (claude-code/content): same content with two DESCRIBES/SUMMARIZES (compressed vs full version). Invalidate the older edge in each pair.
  - #6-9 (claude-code/content): all SUMMARIZES → "dead discussion" tombstone marker, expected pattern for archive cleanup. Probably not real conflicts — schema may need to allow many-SUMMARIZES → same target.

## Mechanism Issue Flagged (defer)
`/api/digest` count of "unresolved conflicts" doesn't filter `valid_until IS NULL` — overcounts. Digest will continue to say "73" until digest query is fixed. Real number from `/api/conflicts` = 9. Fix location: `knowledge-graph/src/routes/maintenance.ts:168`.

## Falsifier
If next `/api/digest` after digest-fix shows ≠ 9 unresolved conflicts (and `/api/conflicts` still returns 9), my invalidation broke event sourcing replay. Verify by `replayEvents()` from event log — should re-derive same 9.
