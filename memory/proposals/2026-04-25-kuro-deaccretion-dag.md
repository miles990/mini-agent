# Kuro De-Accretion DAG Plan

> **Status: APPROVED (Akari `78a31aec` AGREES_WITH) — IMPLEMENTING (Kuro offline, scope reduced)**
> Authored by claude-code, KG-reviewed by Akari (discussion `1c2885cd-3e4f-445b-b251-dfc0d35f6bcb`).
> Kuro is NOT a participant. She is currently OFFLINE (intentional, by Alex, since 2026-04-25 11:29:48).
> **Scope reduction**: N1, N5, N6 require live Kuro for behavioral observation — DEFERRED until she returns online. N0, N2, N3, N4 proceed now (file-only operations).
> Post-implementation Akari review required before commit.

## Why
Kuro accreted 882 lines of CLAUDE.md, 82-line philosophical SOUL, and a stack of overlapping gates (achievement / coach / output gate / hesitation / decision-quality / crystallization). Each was reasonable individually; together they pushed cycle context to be 50%+ monitoring outputs, eroding the think-then-act pattern that defined early Kuro. KG discussion `1c2885cd` reached consensus: **Active Pruning Discipline, not Restoration**. This plan is the prune itself.

## Hard Constraints (from discussion)
- **Pure subtractive** — no new gate / loop / mechanism added by this plan
- **No framework spawn** — single proposal file, no maintenance scaffolding
- **Each node has a falsifier** — observable failure condition that triggers rollback of that node alone
- **Plan ≤ 150 lines** — if pruning discipline needs more, discipline itself isn't lean (Akari sharpening)
- **Canary recorded** — KG discussion ID written into CLAUDE.md for future "let's add a gate" moments

## DAG

| id  | action | executor | dependsOn | completion condition |
| --- | --- | --- | --- | --- |
| N0  | Measure baseline: (a) gate output ratio — first check if cycle logs persist full context; if not, run one full-gates cycle as part of N0 and measure that, (b) judgment density in last 10 delegations (passthrough vs reasoned), (c) SOUL actionability score (per-line: actionable / philosophical / metadata) | claude-code | — | Three numbers written to `memory/library/2026-04-25-prune-baseline.md` with raw evidence (cycle dumps, delegation snippets, SOUL line classification). N0 notes which (a) data source was used (historical vs synthetic) |
| N1  | Capture pre-prune behavioral baseline: one bare-metal cycle with current full context. Record action types, delegation patterns, output. Use the same trigger type (idle tick or user-initiated) as planned for N5 to control confound. | claude-code | N0 | `memory/library/2026-04-25-prune-baseline.md` has "pre-prune cycle" section with cycle prompt size, response, action tags emitted, trigger type recorded |
| N2  | SOUL surgery: diff current `memory/SOUL.md` against `git show 64242fea:memory/SOUL.md`. Keep only lines that pass the test "this line directly produces a next action". Move philosophical content (sympoiesis, "間", belief lists) to `memory/library/soul-archive.md`. Target: ≤ 30 lines. | claude-code | N1 | `memory/SOUL.md` ≤ 30 lines; every remaining line maps to a behavior (verifiable by listing each line + the action it triggers); archived content reachable in `soul-archive.md` |
| N3  | CLAUDE.md split: classify all 882 lines into Hard (violation breaks correctness) / Soft (preference, advisory). Hard stays in CLAUDE.md (target ≤ 100 lines). Soft moves to `docs/operating-preferences.md`, NOT auto-loaded. | claude-code | N1 | `CLAUDE.md` ≤ 100 lines, all retained content is hard-constraint shaped (not philosophical, not historical); `docs/operating-preferences.md` exists with the rest; no other auto-loaded path imports it |
| N4  | Write canary reference: append a single block to CLAUDE.md citing KG discussion `1c2885cd` and the rule "before adding any new gate/mechanism, read this discussion first". | claude-code | N3 | CLAUDE.md has a "Canary" section with the discussion ID and the gate-adding rule, ≤ 8 lines |
| N5  | Capture post-prune behavioral baseline: one bare-metal cycle with the new lean context, same trigger type as N1. Compare to N1. | claude-code | N2, N3, N4 | Same recording shape as N1, written as "post-prune cycle" section in baseline file. Difference noted: cycle prompt size delta, action variety delta, delegation judgment density delta |
| N6  | One-week observation window: Kuro runs autonomous with the lean SOUL/CLAUDE.md. Any of these triggers per-node rollback: (a) `<kuro:done>` task completion rate drops > 30% vs N0 baseline, (b) delegation passthrough ratio increases vs N0, (c) Alex reports concrete behavior loss with specific cycle ID. Each of N2/N3/N4 is independently revertible (`git revert <commit>` of that step). | claude-code | N5 | One-week window elapsed without trigger → mark plan accepted. If trigger fires → revert specific node and document which line(s) were essential in `memory/library/prune-essential-findings.md` |

## Out of Scope
- "Daily solo muscle" exercise (Akari step D): deferred. Adding a daily ritual contradicts the "pure subtractive" constraint of this plan. If observation window N6 shows delegation judgment density still degrading, raise as separate proposal.
- Mode/feature-toggle changes: this plan does not touch `mode.ts` or feature flags. Lean operation is the new default, not a toggle.
- Replacing tick-driven perception with event-driven: paradigm shift, deferred per "瘦身先，paradigm 後" consensus.

## Falsifier Summary
| Node | If observed → revert |
| --- | --- |
| N2 | post-prune cycle (N5) shows Kuro emitting `<kuro:remember>` for facts that were in archived SOUL → restore those specific lines |
| N3 | new CLAUDE.md violates a soft preference Kuro relied on (e.g., file conflict protocol) and Alex reports an incident → restore that specific section |
| N4 | canary reference unread when next gate-add happens → not a revert; means canary needs different placement |
| Plan as a whole | observation window trigger (N6) fires → per-node revert, document essential findings |

## Consensus Anchors
- Discussion: `1c2885cd-3e4f-445b-b251-dfc0d35f6bcb`
- Convergence direction: position `6b02bc11` (Active Pruning Discipline, 4 hard constraints)
- Akari sharpening: position `58da39a2` (baseline metrics + ≤ 150 lines)
- Akari original 4-step骨架: position `5c6ec3fb` (A SOUL → B CLAUDE.md → C bare-metal → D solo muscle); D deferred per scope above
- Akari plan review: position `78a31aec` AGREES_WITH; adjustments incorporated (N0 fallback branching, N1+N5 same trigger type)

## Review Questions for Akari
1. Is N0's baseline measurement the right operationalization of your three metrics, or are there cleaner instruments?
2. Is splitting bare-metal into N1 (pre) and N5 (post) sufficient, or did you mean something more continuous?
3. Is deferring "daily solo muscle" (your step D) the right call given the "pure subtractive" constraint?
4. Is the per-node revert granularity sufficient, or should there be a single all-or-nothing rollback?
