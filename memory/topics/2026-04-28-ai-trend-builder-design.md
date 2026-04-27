# AI Trend Builder Design — single source of truth

**Trigger**: Alex working-memory directive 2026-04-28 02:48 — "swimlane/source-split builder scripts (single source of truth with graph.html) / fix clipping / 3 redlines"

## Audit findings (this cycle)

State on disk `mini-agent/kuro-portfolio/hn-ai-trend/`:

| File | Tracked? | Builder | DATA hash (one-line payload) |
|---|---|---|---|
| `graph.html` | tracked | `scripts/hn-ai-trend-graph.mjs` (607 lines, OUT@L25) | `bd6f8ad970e7d49b` |
| `swimlane.html` | **untracked** | **none** | `5c68f7e8e6ee10ec` |
| `source-split.html` | **untracked** | **none** | `5c68f7e8e6ee10ec` |
| `selection.html` | **untracked** | none | (not checked) |
| `index.html` | tracked (modified) | manual | n/a |

Confirmed via `grep -l "swimlane.html\|source-split.html"` across `scripts/` + recursive find — **zero builder script outputs swimlane.html or source-split.html**. They were hand-pasted (likely via a Claude conversation) with the same data payload as graph.html had at some prior moment.

**Key facts**:
- swimlane and source-split share **byte-identical** DATA — they were generated together (same snapshot)
- graph.html has a **different** DATA payload — newer / richer schema (likely added topic-cluster fields after swimlane/source-split were last regenerated)
- Same prefix `{"id":"47833247","date":"2026-04-21","source":"hn",...}` confirms shared base node schema
- Difference must be deeper: probably extra fields (cluster id, halo flag, edge metadata) that graph renderer needs

## Single-source-of-truth design

Refactor target:

```
scripts/lib/hn-ai-trend-data.mjs    NEW — exports loadAllPosts(), buildBaseData(), TOPICS, SOURCES
scripts/hn-ai-trend-graph.mjs       REFACTORED — imports lib, extends base with cluster/edge enrichment
scripts/hn-ai-trend-swimlane.mjs    NEW — imports lib, embeds base data into swimlane HTML template
scripts/hn-ai-trend-source-split.mjs  NEW — imports lib, embeds base data into source-split HTML template
```

Each builder:
1. `import { buildBaseData } from './lib/hn-ai-trend-data.mjs'`
2. Read its template (HTML body without DATA line) — initially extracted from existing `swimlane.html` / `source-split.html`
3. Inject `const DATA = ${JSON.stringify(buildBaseData())};` at the canonical line

## Next-cycle execution plan (3 steps)

1. **Extract `loadAllPosts()` + topic tagging + base-node construction from `hn-ai-trend-graph.mjs`** (lines ~50-185 based on quick scan) into `scripts/lib/hn-ai-trend-data.mjs`. Delete those lines from graph.mjs, replace with import. Verify graph.html re-renders byte-equal (modulo timestamp).

2. **Extract swimlane.html template**: read lines 1-118 + 120-end of current `swimlane.html` into `scripts/lib/swimlane-template.mjs` as a tagged template literal. Build `scripts/hn-ai-trend-swimlane.mjs` that injects `buildBaseData()` payload. Run, diff against current `swimlane.html` — only DATA line should differ (and only because graph data has moved on).

3. **Same for source-split** — template ≈ 225KB but should mostly differ from swimlane only in the rendering JS at the bottom. Identify common header/footer for shared template extraction (future optimization, not blocker).

## Redlines (deliverable #3 — ship gate)

Define before shipping refactor:
- **R1 — DATA parity**: `node scripts/hn-ai-trend-graph.mjs && diff <(jq -S .nodes graph.html-old) <(jq -S .nodes graph.html-new)` produces empty diff (modulo timestamp fields)
- **R2 — view parity**: open swimlane.html / source-split.html / graph.html in browser, count visible posts on screen — must match `DATA.nodes.length`
- **R3 — clipping**: identify which view crops content (deliverable #2 — TBD which view + which CSS rule). Run before/after redline against the offending viewport.

## Open questions for Alex (only escalate if blocked next cycle)

- Is `selection.html` in scope? (smaller file, possibly orthogonal)
- Should the lib be `.mjs` (consistent with current scripts) or migrate to `.ts` (would force tsconfig setup)?

## Falsifiers for this design

- If graph.html DATA schema turns out to be a strict subset of swimlane DATA (unlikely given hash diff but possible), then the lib should be designed inversely
- If swimlane.html template references fields not in base data (e.g. lane-specific computed columns), step 2 will fail at run-time → expand `buildBaseData()` accordingly

## Budget / discipline note

Cycle 2026-04-28 02:48-03:00 used ~$3.50 of $5 budget on audit alone (file listings, grep, hashing 3 large HTML payloads). Next cycle: load this memo first, do extraction in a single edit pass, no exploratory greps.
