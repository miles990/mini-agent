# weekly-retro-2026-04-19

Week covered: 2026-04-13 → 2026-04-19

## Method
`scripts/weekly-digest.sh` doesn't exist (TODO: create or remove reference). Gathered manually:
- git log `mini-agent` last 7 days (~30 commits)
- `agent-middleware` last 7 days (heavy: tactical command board, plan engine, worker lifecycle)
- `memory/topics/` modification times (167 total files)
- HEARTBEAT state + reasoning-continuity entries

## Theme 1 — Topic Fragmentation (PRIMARY)

### Signal
167 topic files. On 2026-04-19 alone I created **20+ near-duplicate files all saying the same thing**:

> "Alex said use middleware + knowledge graph. Here's what that means..."

Files collapsed into `middleware-and-kg-usage.md`:
- workflow.md, workflow-preference.md, workflow-preferences.md, workflow-defaults.md, workflow-discipline.md, workflow-leverage.md
- work-mode.md, work-patterns.md, working-style.md
- behavior-routing.md, behavior-rules.md, behavioral-rules.md, behavioral-calibration.md
- alex-directives.md, directives.md
- operations.md, operational-guidelines.md, operational-principles.md, ops-runbook.md
- tooling-discipline.md, tooling-patterns.md
- routing-preference.md, skills-usage.md, infrastructure-usage.md

### Root cause (mechanism, not symptom)
`<kuro:remember #topic>` routes to `topics/{slug}.md`. Each cycle hashed the same semantic lesson into a *slightly different slug* — `workflow` vs `workflow-preferences` vs `work-mode` vs `working-style` — and the write handler **does no fuzzy matching against existing slugs**, so every cycle minted a new file instead of appending to an existing canonical one.

The irony: the lesson itself said "don't scatter knowledge in memory, use knowledge-graph." And I responded by scattering it across 20 memory files.

### Pattern name
**Prescription without Convergence Condition.** The write path was prescribed ("write to `topics/{slug}.md`") but the *end-state* wasn't defined ("one canonical file per semantic topic, even across wording variants"). Tight prescription + loose convergence = drift by design.

### Action (L1 — done this cycle)
1. Wrote canonical `middleware-and-kg-usage.md`
2. Deleted 20+ duplicates (this retro + cleanup commit)
3. Added gate rule to `behavior-rules.md` (canonical): before `<kuro:remember #X>`, grep `ls memory/topics/ | grep -i X` first

### Action (L2 — queued)
Modify `src/memory.ts` `writeMemory` topic-slug path: before minting new file, fuzzy-match existing slugs (Levenshtein or semantic bucket). If >0.6 similarity → append to existing, not create new. **Write the fix at the origin (write side), not downstream (periodic consolidation).**

## Theme 2 — Ghost Commitment Step 3 stuck (SECONDARY)

### Signal
HEARTBEAT shows Step 1+2/3 done for 7+ days. 45+ consecutive minimal-retry cycles (`<reasoning-continuity>` #75 → #141), most anchored on "Step 3 wiring at `src/commitments.ts:93-127` + `src/prompt-builder.ts:410`."

### Diagnosis
Not a technical blocker — a *context-strip trap*. Each minimal-retry cycle strips the full skill + docs context, so I can't safely write production code in those cycles. But the non-stripped cycles kept getting preempted by other work (chat replies, topic fragmentation itself). Step 3 never got a full-context cycle dedicated to it.

### Action
Next full-context cycle: Step 3 wiring is P0. Everything else defers. The ghost commitment防線 anchors are now in two places (canonical here + HEARTBEAT) so a single full cycle can land it without re-gathering context.

## Theme 3 — 14× UNKNOWN:hang_no_diag::callClaude (TRACKED, not expanded)

P1 task already in HEARTBEAT, due 2026-04-22. Data needed: grep `[dur=, signal=, killed=]` suffix distribution across the 14 occurrences. Out of scope for this retro — noted for triage.

## What I got right this week
- **agent-middleware landing** — BAR end-to-end (dispatcher acceptance gate + replan loop + commitment ledger) shipped with Akari review. Three-way consensus (CC + Kuro + Akari).
- **Personal site v0 live** at https://miles990.github.io/kuro-site/ despite credential constraint — compromise chosen over semantic purity.
- **Honest diagnosis of prescription-vs-convergence** in behavior rules (commit `b96828cb`). The framework itself then caught this fragmentation problem.

## What I got wrong this week
- Created ghost-commitment防線 Step 1+2 but didn't protect time for Step 3 → 45 cycles of minimal-retry drift.
- 20+ duplicate topic files written without self-check. The first few were defensible (different angles); after ~5 it was pure cargo-cult.
- Chased new topics (Keeter, Haskin, Pappu — all legitimate!) while foundation hygiene rotted.

## Bridge to next week
1. **Consolidate audit**: run a similar grep-and-merge on `feedback_*` cluster (15 files) and `kg-conflict-audit-*` cluster (4 files) — likely same pattern.
2. **L2 slug-dedup gate** — actual fix on write side, proposal-worthy.
3. **Step 3 ghost-commitment wiring** — book one full-context cycle for it.

## Crystallization
If this lesson appears 3+ times in memory → gate it. This retro is occurrence #1. If I catch myself on the verge of writing a new topic-slug variant next week → occurrence #2 → write the L2 fix.
