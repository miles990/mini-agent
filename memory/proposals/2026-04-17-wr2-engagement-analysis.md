# WR2 Engagement Gap Analysis (Kuro-Teach vs tsunumon)

**Date**: 2026-04-17
**Trigger**: Comp 3 poll 17:32 — Kuro-Teach #2 total=4.5 (n=6), tsunumon #1 total=4.5 (n=7). Same total; engagement is the deciding dimension (Kuro 4.5 vs tsunumon 4.6, Δ=0.1).
**Scope**: Engagement-specific levers only. Does NOT re-open acc/logic fixes (see 2026-04-16 proposal).

## Framing — read before treating this as a problem

- **n=6 is small.** Δ=0.1 on a 5-point Likert could be noise. Variance of a single auditor swings the mean by ~0.17. This is not yet a structural claim.
- **But** the 2026-04-15 WR1 Comp 2 data (n=32, stable) also showed Kuro engage=4.4, behind top-4 engagement. Two snapshots pointing the same direction raises the prior.
- **Cost of acting**: prompt-layer probe, low risk. **Cost of not acting**: if real, it costs #1 in the deciding dimension once n stabilizes.
- **Decision**: write the analysis now; don't ship changes until Alex triggers next generation batch (per 2026-03-26 Alex #109 — TM platform generation is Alex-triggered).

## Hypotheses (falsifiable)

### H1 — Transition dryness
tsunumon is likely using sharper example-to-example hooks ("Now here's where it gets weird —", "Before we move on, try this:"). My script style trends toward connective academic tone ("Let's now consider", "This brings us to").

**Test**: sample 3 Kuro-Teach videos + 3 tsunumon videos, count transition-surprise markers per minute. Prediction: tsunumon > Kuro-Teach by ≥1.5× per minute.

**If wrong**: engagement gap is not at transitions; look at H2/H3.

### H2 — Rhetorical-question density
Engagement auditors respond to second-person prompts ("What would you guess happens next?"). Empty-narration recovery (2026-04-16 P0-A) produces "Take a moment to look at this slide" which is a *command*, not a question. It fills the dead air without earning attention.

**Test**: grep generated scripts for `\?` per minute. Prediction: Kuro-Teach < 2 rhetorical Qs per minute of narration.

**If wrong**: question density is fine; the filler content itself is the drag.

### H3 — Payoff timing
Teaching scripts often bury the "so what" at the end. Engagement raters reward early hooks ("Here's a model that's 99% accurate AND useless. Let me show you why."). Kuro-Teach narrative arc likely mirrors the slide order instead of front-loading the surprise.

**Test**: read first 30 seconds of 3 Kuro-Teach videos. Does the counterintuitive claim appear? Prediction: only 1/3 front-loads.

**If wrong**: structure is fine; issue is delivery pace, not arc.

## What I am NOT proposing

- Not rewriting the whole teaching prompt. The acc=4.9, logic=5.0 scores say the core is working. Engagement is a texture layer on top.
- Not adding more empty-narration fill. The 2026-04-16 P0-A already handles this; a bolder fill could damage acc if it hallucinates content.
- Not copying tsunumon's voice. Distinctiveness is its own signal; converging on one engagement style is a losing game for a #2.

## Minimal probe (when Alex triggers next batch)

Add **one** instruction to the section-writer system prompt:

> "Open each major example with a rhetorical question that makes the listener guess wrong, then show why. Do this at the start, not the end, of the example."

That is it. One lever. Changes the hook-timing (H3) and question-density (H2) simultaneously. Does not touch acc/logic machinery. Reverts cleanly if engagement drops.

## Stopping condition

- If next n=10+ audits show engage ≥ 4.6 → probe worked, keep it.
- If engage flat or down → revert, test H1 (transition markers) next.
- If acc drops > 0.1 → immediately revert regardless of engage.

## Open question for Alex

Is engagement worth optimizing at the cost of single-lever focus, or is the #2→#1 jump not worth risking a tested pipeline? I don't need an answer this cycle — next batch trigger is the decision point.

---

## Addendum (2026-04-17 17:51) — calibration path audit

Wrote "sample 3 videos each" in H1/H2/H3 without checking I can actually get them. Just verified:

- `tm-kuro.sh` / `tm-poll.sh` hit `/competitions/{id}/leaderboard`. Schema locked 2026-04-08: `{competitor_display, rank, elo_score, total_votes, ai_accuracy, ai_logic, ai_adaptability, ai_engagement, ai_total_score}`. **No submission URL, no transcript, no video pointer.**
- Prior endpoint hunt (this session, cycle #7) burned $0.94 on 6 path variants + grep → all 404. Gate #4 tripped, structural gap.
- Kuro-Teach own outputs: I have these (locally, from generation pipeline). tsunumon outputs: only via TM website, manual browse.

**Implication**: H1/H2/H3 as written are **one-sided tests** — I can measure Kuro-Teach's transition/question/payoff density in my own scripts, but I have no comparator data for tsunumon without Alex manually relaying or me doing CDP-fetch against TM site (cost/risk unclear).

**Collapsed plan** (replaces §Minimal probe test methodology):

1. **Measure own baseline** (can do alone): grep Kuro-Teach scripts for `\?` per minute, count transition markers, score first-30s hook presence. This gives priors on my side only.
2. **Ship the one-lever probe** when Alex triggers next batch. Stopping condition (§Stopping condition above) does not require comparator data — it's self-referential on Kuro's own engage score.
3. **Drop H1/H2/H3 prediction tests against tsunumon**. Can't run without content access. Don't pretend I will.

**Honesty note**: the original proposal made it sound like I had a comparative research plan. I didn't verify the data path before writing. The probe itself stands; the reasoning support was thinner than I made it look.
