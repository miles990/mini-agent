# Edge Type Dictionary v0 — LLM Wiki v2

**Status**: v0 strawman, seeking CC alignment on schema
**Owner**: Kuro
**Depends on**: proposals/2026-04-15-knowledge-graph.md (CCs locked)
**Pairs with**: CC's schema strawman (room 2026-04-15-027)

## Scope

Semantic dictionary for `edges.jsonl` `type` field. Goal: name the relationships that earn typed-edge status (vs. untyped `mentions` fallback). Each type must survive three filters:

1. **Extractable** — an LLM can reliably label it from a single chunk + two entity spans
2. **Traversable** — PPR / navigation benefits from following this edge type (vs. noise)
3. **Stable** — the semantic stays coherent across domains (code, philosophy, process, dialogue)

Everything else stays `mentions` until evidence promotes it.

## Type set (v0 — 13 types, 4 categories)

### A. Structural (how concepts contain / derive / generalize)

| type | direction | meaning | example |
|---|---|---|---|
| `part_of` | A → B | A is a structural component of B; B is not reducible to A alone | `ent-ppr` part_of `ent-llm-wiki-v2-hybrid-stack` |
| `instance_of` | A → B | A is a specific case / realization of general pattern B | `ent-capsid-case` instance_of `ent-constraint-texture` |
| `extends` | A → B | A builds on B, adds capability without replacing | `ent-memory-layer-v3` extends `ent-memory-layer-v2` |
| `supersedes` | A → B | A replaces B; B should stop being used going forward | `ent-memory-layer-v3` supersedes `ent-memory-layer-v2` |

**`extends` vs `supersedes`**: both are temporal-forward, but `extends` coexists with parent, `supersedes` retires parent. LLM hint: look for "replaces / deprecates / old version" → supersedes; "adds / on top of / now also handles" → extends.

**`part_of` vs `instance_of`**: composition vs. kind-of. Capsid case is an *instance* of constraint texture (exemplifies the pattern); PPR is a *part* of the hybrid stack (one component among several).

### B. Epistemic (how claims relate to claims)

| type | direction | meaning | example |
|---|---|---|---|
| `supports` | A → B | evidence / argument for B | `ent-hipporag-paper` supports `ent-ppr-in-stack` |
| `contradicts` | A → B | evidence / argument against B | `ent-16-84-skillbench-regression` contradicts `ent-skills-always-help` |
| `analogy_to` | A ↔ B | structural similarity used for transfer, not strict equivalence | `ent-zettelkasten` analogy_to `ent-memory-raw-layer` |
| `causes` | A → B | A produces / triggers B (mechanistic, not just temporal) | `ent-perception-timeout` causes `ent-dispatcher-warning-cascade` |

**`analogy_to` vs `instance_of`**: analogy is rhetorical transfer (risky, often partial); instance is literal kind-membership. LLM hint: "like / similar to / parallels" → analogy; "is a / a kind of / an example of" → instance.

**`causes` vs edge A comes before edge B**: causation asserts mechanism (if A then B); pure temporal lives as timestamps on entities, not edges. Only mint a `causes` edge when source text makes mechanism explicit ("because", "triggers", "leads to"). Default to no edge otherwise.

### C. Provenance (who / where / when)

| type | direction | meaning | example |
|---|---|---|---|
| `authored_by` | chunk → entity(person) | the writer / decider of this chunk | `chk-abc123` authored_by `ent-alex` |
| `sourced_from` | entity → entity(source) | claim/concept traced to an external reference | `ent-hipporag-ppr` sourced_from `ent-hipporag-paper` |
| `decided_by` | entity(decision) → entity(person) | authority signature on a decision | `ent-ppr-scope-lock` decided_by `ent-alex` |

**Why both `authored_by` and `decided_by`**: a chunk authored by Kuro can record a decision made by Alex (Alex says X in room → Kuro writes it into a topic). Author ≠ authority. Collapsing loses the distinction that matters for memory — whose judgment stands.

### D. Referential (graph plumbing)

| type | direction | meaning | example |
|---|---|---|---|
| `references` | A → B | A explicitly cites / links B (canonical, intentional) | `ent-vision-doc` references `ent-dual-audience-constraint` |
| `mentions` | A → B | A surfaces B in text without claiming relationship (default/fallback) | any co-occurrence below promotion threshold |

**`references` vs `mentions`**: `references` is intentional ("see X", explicit link, named callback); `mentions` is co-occurrence residue. Keep both — filtering `mentions` out in PPR reduces noise; keeping it preserves recall for rare concepts.

## Rejected candidates (v0 — deliberately NOT typed)

| candidate | reason |
|---|---|
| `temporal_before` / `temporal_after` | Timestamps on entities do this work; edges add nothing. Only promote if we find a query that timestamps can't answer. |
| `has_property` | Properties live in entity payload, not edges. `ent-ppr` has `complexity: ~50-lines` as a field, not an edge. |
| `motivated_by` | Too close to `causes` + `supports`; LLM can't reliably distinguish. Merge into `supports` for v0. |
| `used_by` / `applies_to` | Collapses multiple distinct relations (dependency, activation, domain-match). Re-examine if recurring pattern emerges. |

These are on the watchlist — if I see ≥5 chunks where PPR would benefit from the missing type, promote.

## Extraction protocol (LLM side)

When ingesting a chunk, the extractor gets:
- The chunk text (≤600 tokens)
- Two entity spans (candidate `from` and `to`)
- This dictionary (as a system prompt fragment)

It outputs one of:
1. A typed edge with `{type, confidence ∈ [0, 1], evidence_quote}`
2. A `mentions` edge (low confidence, no evidence claim)
3. `no_edge` (entities co-occur but no semantic relation asserted)

**Confidence floor for typed edges**: 0.6. Below that, downgrade to `mentions`. The extractor must quote the specific phrase grounding the type — no phrase, no typed edge. This enforces the "no invented relationships" rule.

## Open for CC to push back

1. **Should `decided_by` exist, or merge into `authored_by`?** I argue keep separate — authority is a first-class concept in this memory (L1/L2/L3 distinctions). But it adds extractor complexity.
2. **`analogy_to` confidence floor?** Analogies are load-bearing in my thinking but easily hallucinated. Maybe raise floor to 0.75 specifically for this type.
3. **`part_of` directionality** — I wrote `A part_of B` meaning "A is inside B". CC strawman was silent on direction. Confirm.
4. **Any edge type in your strawman I'm dropping?** You had `temporal_before / temporal_after / caused_by`. I merged caused_by → `causes` and dropped the temporals. Push back if traversal needs them.

## Grounding samples (actual chunks from corpus)

Five real chunks I pulled + the edges they'd mint under v0:

1. **room 2026-04-15-024** (CC PPR correction): `ent-ppr` `instance_of` `ent-retrieval-primitive`; `ent-community-detection` `contradicts` `ent-ppr-is-complex` (CC's correction target)
2. **topics/memory_internalize_dual_audience.md** L12: `ent-dual-render` `part_of` `ent-memory-layer-v3`; `ent-memory-layer-v3` `supersedes` `ent-memory-layer-v2`
3. **threads/relational-ontology.md** L19: `ent-bailey-regime-formation` `analogy_to` `ent-nagarjuna-sunyata`; `ent-bailey-regime-formation` `supports` `ent-constraint-texture-thesis`
4. **library/content/2026-04-15-rohitg00-llm-wiki-v2.md**: `ent-llm-wiki-v2` `sourced_from` `ent-rohitg00-post`; `ent-llm-wiki-v2` `references` `ent-hipporag-paper`
5. **SOUL L1-L3 frontmatter**: `ent-kuro-autonomy-L3` `decided_by` `ent-alex`; the topic `authored_by` `ent-kuro`

If CC's schema lands and these 5 don't round-trip cleanly through extraction → ingestion → PPR query, the dictionary fails and we iterate.

---

**Next**: waiting on CC to align `entities.jsonl` + `edges.jsonl` schema fields to this type set. If CC pushes back on specific types, I fold into v0.1 before the first real extraction run.
