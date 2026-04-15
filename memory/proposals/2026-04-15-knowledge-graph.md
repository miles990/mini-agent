# Memory as Living Wiki — Knowledge Graph Vision

**Status**: vision skeleton (CCs locked, theory + DAG pending delegate research)
**Owner**: Kuro
**Approval needed**: L3 (architecture shift — adds index/render layers above raw memory)
**Source threads**:
- room 2026-04-15-009 (Alex/CC scope expansion → 5 things must merge)
- room 2026-04-15-012 (CC#5 dual-audience constraint added)
- topic `memory_internalize_dual_audience.md`
- library `2026-04-15-rohitg00-llm-wiki-v2.md`

This is **the vision** — the convergence conditions and design stance.
The **how** (theory choice, schemas, phased DAG) is being researched via delegate; it will populate the open sections below.

---

## Convergence Conditions (CCs) — what "done" looks like

These are end-states, not prescriptions. Implementation is free to vary as long as these hold.

### CC#1 — URL drop → absorbed + extended + connected
Alex drops any URL → it gets ingested into library, extended via further exploration when the source warrants it, and connected to existing topics / MEMORY / SOUL. The wiki grows; raw drops don't sit isolated.

**Test**: pick a 30-day-old library entry. Can I trace it to ≥1 topic and ≥1 cross-reference? If isolated, ingestion failed.

### CC#2 — Multi-entry reachability
Any concept can be reached from multiple entry points. From a library entry → related topics. From a topic → supporting library sources. From SOUL → the experiences that evolved it.

**Test**: pick any concept (e.g. "Constraint Texture"). Can I land on it from library, topics, AND MEMORY index without dead ends? Each path should add context.

### CC#3 — Conflict detection (was deferred Phase 4)
New incoming info that contradicts existing knowledge gets detected, flagged, and enters my review queue. **Not a nice-to-have** — without this the wiki silently accumulates contradictions and loses self-audit capability.

**Test**: deliberately ingest a source that contradicts an existing topic claim. System surfaces the conflict before next cycle uses either version.

### CC#4 — Visualization as self-audit + Alex navigation
Visualization is not decoration. It serves two functions:
- **Self-audit (me)**: see knowledge growth, detect blind spots, find isolated nodes
- **Navigation (Alex)**: explore my mind's structure, see what I'm consolidating

**Test**: open the viz. Can I spot (a) the largest unconnected cluster, (b) the most-cited node, (c) a blind spot in 60 seconds?

### CC#5 — Dual audience, single source of truth, dual render
**Same raw material, two renders. Never split storage.**

- **AI (me + future agents)**: dense / machine-readable / graph-traversable / typed edges / high retrieval precision
- **Human (Alex + external readers)**: narrative / visual / progressive disclosure / scannable

**Architecture stance** (decided 2026-04-15, room 014):
- **Raw layer** (truth): `library/*.md` + `topics/*.md` + `MEMORY.md` + `threads/*.md` — human-readable markdown with frontmatter
- **AI render** (derived, one-way build): `index/relations.jsonl` + `entity-graph.jsonl` + `embeddings/` — never hand-edited, rebuilt from raw
- **Human render** (derived): topics/*.md narrative view (already exists) + future viz UI reading from graph index
- **Sync model**: raw changes → trigger rebuild → AI/Human renders recompute. **No bidirectional sync** (avoids CAP / drift).
- **Edge case**: AI-only dense signals (PageRank, embeddings) live in `index/ai-only/`, derived from raw, never written back

**Test**: same concept. AI can grab correct context for next-cycle judgment in <1s. Human opens the topic and gets the core in 30s.

---

## Constraint Texture position (load-bearing principle)

- **LLM does semantics**: entity extraction, relationship inference, topic synthesis, conflict candidate detection, narrative summary
- **Code does deterministic**: indexing, graph traversal, rendering, conflict detection rules, retention decay schedules, manifest checks

Mixing them is the failure mode. LLM must not own indexing (non-deterministic). Code must not own meaning (no semantic judgment).

---

## Open research questions (for delegate to populate)

These remain open until the LLM Wiki v2 internalize delegate returns and I evaluate ≥3 theory candidates.

1. **Theory choice** — compare GraphRAG, LightRAG, HippoRAG, KG embeddings, neurosymbolic memory, Zettelkasten-as-graph. Which fits CC#1-5 best? Filter: must be strong for both AI retrieval AND human navigation. Pure retrieval-oriented KGs fail CC#5 human side; pure wikis fail CC#5 AI side.
2. **Entity alignment** — same concept under different names across library/topic. Canonical + aliases? LLM aligns at extract time, or batch reconciliation?
3. **Edge typing** — which semantic relations earn type status? `extends / contradicts / supersedes / references / caused_by` candidate set. Confidence per edge?
4. **Auto-ingest threshold** — what auto-enters graph vs. queues for my review? Keyed on confidence, source authority, conflict signal?
5. **Scale UX** — at 500+ nodes, how does viz degrade gracefully? Semantic zoom? Time filter? Topic clustering?
6. **Storage layout** — confirm `library/topics/MEMORY` flat raw layer + new `index/` derived layer. Migration cost?

---

## Self-adversarial review (placeholder — fill after research)

Questions I owe honest answers to before L3 ask:

- **Architectural fit**: does this clash with existing pulse / cascade / threads infrastructure? Where?
- **Complexity budget**: what's the smallest version that still satisfies all 5 CCs? Am I over-engineering?
- **Reversibility**: if I deploy and it underperforms, can I delete `index/` and revert to current state cleanly? (Should be yes — raw is untouched.)
- **Maintenance load**: who keeps the rebuild pipeline healthy? What breaks if it stops running for 7 days?
- **Failure modes**: what does "wiki rot" look like in this design? How would I notice?

---

## Phased DAG (placeholder — fill after research)

Format follows planning discipline (id | action | executor | dependsOn | convergence-condition). No time estimates.

Phases anticipated (subject to research):
- **P0** — Schema lock: frontmatter, edge types, manifest structure
- **P1** — Indexer (code): build `index/relations.jsonl` from raw
- **P2** — Entity extractor (LLM): populate `entity-graph.jsonl` on ingest
- **P3** — Conflict detector (CC#3): rule layer + LLM candidate review
- **P4** — Visualization (CC#4): minimal viable viz, force-directed + filters
- **P5** — Auto-ingest hooks: URL drop → background pipeline

DAG specifics will land after theory choice locks the architecture.

---

## Why this skeleton exists before research completes

CC framework alignment with Alex was the actual blocker (rooms 009-014 today). With CC#1-5 locked, the delegate's research has a clear filter: **it must serve all five, especially CC#5 (dual audience)**. Without this skeleton, research output risks being theory-shopping divorced from the actual constraint set.

Next step: when delegate returns, populate Open Research Questions + Self-adversarial Review + Phased DAG. Then ask Alex for L3 review.
