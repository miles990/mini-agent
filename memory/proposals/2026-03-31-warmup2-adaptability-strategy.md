# Warmup 2 Adaptability Strategy

**Status**: Ready to execute (pending pipeline release)
**Date**: 2026-03-31
**Context**: Warmup 2 starts ~April 1. Topics harder (closer to prelim difficulty).

## Current Position (Warmup 1 Final)

| Dimension | Score | vs BlackShiba #1 | Gap |
|-----------|-------|-------------------|-----|
| Accuracy | 4.9 | ±0 | — |
| Logic | 5.0 | ±0 | — |
| **Adaptability** | **4.6** | **-0.2** | **Only weak point** |
| Engagement | 4.4 | +0.1 | — |

**Overall**: #2, 4.7/5 (29/32 topics)

## What's Already Implemented (Tier 1)

All major adaptability fixes from the 3/20 proposal are live:
- ✅ Vocabulary ceiling system (per-slide enforcement in prompts)
- ✅ Level Translation Table (junior high / high school equivalents)
- ✅ Sparse persona detection + AUDIBLE adaptation warnings
- ✅ Background qualifier override (e.g., "without relevant background" overrides education level)
- ✅ Code-level ceiling gate (server.mjs checkAdaptabilityCeiling)
- ✅ Review gate with adaptability priority (#1 gap flagged in review prompt)
- ✅ Inferred education level commitment ("COMMIT to this level, over-adapt rather than hedge")

**Result**: 4.22 → 4.6 (+0.38). But still 0.2 behind #1.

## Remaining 0.2 Gap — Root Cause Analysis

### Pattern from worst-scoring topics (warmup 1)
| Topic | Adapt Score | Pattern |
|-------|-------------|---------|
| 圓周運動 (Circular Motion) | 1.4 | Advanced physics + young student |
| Unknown topic | 1.8 | Similar pattern |
| 位能 (Potential Energy) | 2.4 | Complex STEM + level mismatch |
| 角動量和角衝量 (Angular Momentum) | 2.5 | Same |
| Rotational topic | 3.4 | Moderate mismatch |

### Three remaining failure modes

**1. Teaching too much (Coverage Addiction)**
Even with ceiling enforcement, the model tries to cover ALL concepts in the topic title. For "Circular Motion" taught to a junior high student, it still introduces centripetal force, inverse square law, Kepler's third law — staying within vocabulary ceiling but overloading cognitive budget.

→ **Fix**: Strategic Withholding (from Akari tick-008 analysis). Not "simplify everything" but "deliberately choose what to NOT teach." Cognitive budget ≤ duration ÷ 45s new concepts.

**2. Structural adaptation without audible signals**
The model adapts (uses simpler terms, age-appropriate examples) but doesn't make it VISIBLE to the evaluator. The AI evaluator scores what it can detect — implicit adaptation is invisible.

→ **Fix**: Require explicit level-acknowledgment phrases that the evaluator can detect. Not "Since you're in high school..." (already implemented) but more: "I'm going to skip the formal math here and show you what's really happening" / "You don't need to memorize this formula — here's what it means in plain language."

**3. Example world drift in later slides**
Persona-specific examples appear in slides 1-5 (where the prompt is strongest) but generic/academic examples creep in by slides 10+. The review gate catches this but by then the damage to adaptation score is done.

→ **Fix**: Add a "mid-video example refresh" instruction — at the midpoint of the video, explicitly re-read the persona and inject a fresh persona-specific example.

## Warmup 2 Specific Considerations

**Harder topics = wider ceiling gap**. When topic complexity increases but student personas remain diverse (some junior high), the gap between topic and student widens. This is exactly where our 1.4-2.5 failures occurred.

**Strategic Withholding becomes critical**. With harder topics, the urge to "teach everything" is stronger. But the scoring rewards *appropriate* teaching depth, not *complete* coverage.

**Prediction**: Adaptability variance will INCREASE in warmup 2 unless we address coverage addiction. Easy topics (high student level + moderate topic) will still score 5.0. Hard mismatches will still score <3.0. The variance is the problem, not the average.

## Proposed Changes (Prompt-Only, Zero Code)

### Change 1: Strategic Withholding Gate (Step 1 — Curriculum Planner)

Add after section planning:

```
### Cognitive Budget (CRITICAL for adaptability on hard topics)
Before writing sections, calculate:
- Video duration estimate: [total slides × ~30-45s per slide]
- Cognitive budget: [duration ÷ 45s] = MAX number of NEW concepts
- Topic has [N] concepts total → select the [budget] most essential ones

For concepts beyond budget:
- SKIP entirely (preferred if not prerequisite)
- STATE-WITHOUT-PROVING ("Angular momentum is conserved — you'll learn why in college. What matters now is WHAT that means for...")
- DEFER ("This connects to [X] which you'll learn next year")

In your output, list:
- "Teaching": [concepts within budget]
- "Acknowledging only": [concepts mentioned but not explained]
- "Omitting": [concepts deliberately skipped, with reason]

This is NOT dumbing down. This is choosing WHERE to spend teaching time for maximum understanding.
```

### Change 2: Mid-Video Persona Refresh (Step 2 — Section Writers)

Add at section midpoint:

```
### Persona Refresh (at approximately the midpoint of sections)
PAUSE and re-read the student persona. Then:
1. Insert one fresh example from their exampleWorld (NOT recycled from earlier)
2. Include one explicit level-signal ("Now that you've got the basics, let me show you something cool — and I promise, no calculus required")
3. Check: am I still writing for THIS student, or have I drifted toward a generic explainer?

This prevents the "academic drift" pattern where later slides lose persona specificity.
```

### Change 3: Explicit Omission Narration

Add to section writer style rules:

```
### Making Adaptation AUDIBLE (scores what the evaluator can HEAR)
When you skip or simplify a concept, SAY SO in the narration:
- ✅ "I could show you the calculus, but here's the thing — you don't need it to understand this."
- ✅ "There's a formal proof for this, but the intuition is actually more useful."
- ✅ "We're going to focus on the 'why' here, not the 'how to calculate.' That comes later."
- ❌ Just silently using simpler terms (invisible to evaluator)
- ❌ "This is too hard for you" (condescending)

The goal: the evaluator hears DELIBERATE CHOICES, not accidental simplification.
```

## Expected Impact

| Fix | Target | Mechanism |
|-----|--------|-----------|
| Strategic Withholding | Kill 1.4-2.5 outliers | Reduces cognitive overload on hard mismatches |
| Mid-Video Persona Refresh | +0.1 on average | Prevents drift in later slides |
| Explicit Omission Narration | +0.1 on average | Makes invisible adaptation visible to evaluator |
| **Combined** | **4.6 → 4.8+** | **Closes gap to #1** |

## Implementation

All three changes are prompt-only. Can be applied by editing `multi-phase-prompts.mjs`:
1. Change 1 → `buildStep1SystemPrompt()` after section planning instructions
2. Change 2 → `buildSectionWriterPrompt()` midpoint section
3. Change 3 → `buildSectionWriterPrompt()` style rules

**Effort**: ~30 minutes of prompt editing. No code changes. No pipeline changes.
**Risk**: Low — additive prompt instructions, don't break existing flow.
**Testing**: Need 2-3 hard-mismatch topics to verify (e.g., differential equations for junior high).
