# Tier 1: Engagement + Adaptability Prompt Improvements

**Status**: Draft
**Effort**: Medium (prompt-only changes, no code)
**Expected Impact**: +0.3-0.5 on total average (4.33 -> 4.6-4.8)
**Files**: `generate-script.mjs`, `multi-phase-prompts.mjs`, `review-script.mjs`

## Problem Analysis (Data-Driven)

32 topics scored. Dimension breakdown:
- **Accuracy**: avg 4.36, 6 below 4 (2 catastrophic at 1.0 — Tier 0 fixes this)
- **Logic**: avg 4.59, 2 below 4 (strongest — prompts work well here)
- **Adaptability**: avg 4.22, 7 below 4 (widest variance: 1.4 to 5.0)
- **Engagement**: avg 4.15, 7 below 4 (weakest — only 2/32 score 5.0)

**Key insight**: Logic is strong because prompts explicitly structure it (bridges, progressive disclosure). Engagement is weak because it's treated as decorative (optional techniques) rather than structural. Adaptability fails on complex-topic-simple-student combos.

**Competitor insight** (tsunumon, #1 at 4.7): Wins on Accuracy(5.0) and Logic(5.0). Their technique: life analogies + **contrastive teaching** (show X vs NOT-X) + patient narrative flow. Uses basic TTS — content quality wins, not production quality.

## Proposed Changes

### A. Engagement (target: avg 4.15 -> 4.5+)

#### A1. Emotional Arc Planning (Step 1 — Curriculum Planner)

Add to section design output format — each section gets an `emotionalArc` field:

```json
"emotionalArc": {
  "hook": "What makes the student curious at the start of this section",
  "tension": "The 'But...' moment — complication, surprise, or counterpoint",
  "resolution": "The satisfying payoff — the student now understands"
}
```

**Why**: Current prompts plan LOGICAL flow (bridges, progressive disclosure) but not EMOTIONAL flow. tsunumon's videos feel engaging because each segment has curiosity -> tension -> satisfaction. Our scripts feel like textbooks read aloud.

#### A2. Contrast Teaching as Core Method (Both prompts)

Add as the 6th teaching method (alongside Scenario-First, Core Analogy, Progressive Disclosure, Misconception Preemption, Checkpoints):

```
### 6. Contrast Teaching (CRITICAL for engagement + understanding)
For every key concept, explicitly contrast what it IS vs what it ISN'T:
- "Momentum is NOT the same as speed — a slow truck has more momentum than a fast tennis ball."
- "Static friction HOLDS things still. Kinetic friction SLOWS things moving. They're opposites."

Plan at least 2 contrast pairs per video. Place them at key concept introductions.
Contrast teaches boundaries — students don't just know what X is, they know where X stops and Y begins.
```

**Why**: Our best-scoring topics already do this implicitly. Making it explicit ensures consistency. tsunumon does this systematically — every concept is bounded by its NOT-counterpart.

#### A3. Narrative Tension in Section Writer

Add to Step 2a (Section Writer) writing style rules:

```
## Narrative Momentum (CRITICAL for engagement score)
Each section MUST have at least one "But..." moment — a point where the simple explanation hits a wall:
- "This works perfectly... for objects at rest. But what happens the moment something starts moving?"
- "You might think we're done. But there's a catch nobody sees coming."

This creates forward momentum. Without it, the script feels like a list of facts.
Do NOT frontload all the "interesting" parts in section 1 — distribute surprises.
```

**Why**: Low-engagement topics (Normal Distribution eng=2.5, Linear Momentum eng=3.0) have correct content but flat narrative. They explain correctly without creating curiosity about what comes next.

#### A4. Student Reaction Moments (Section Writer)

Strengthen existing "student voice" from optional to required:

```
## Student Reactions (Required — at least 1 per section)
Voice the student's likely reaction at a moment of surprise or confusion:
- "Wait — so heavier objects DON'T fall faster? Then why does a feather fall slower than a bowling ball?"
- "Hold on, if the forces are equal, why does the car crush the bug and not the other way around?"

This is NOT a rhetorical question from the teacher. This is the student thinking out loud.
It creates dialogue feel and validates the student's confusion before resolving it.
```

### B. Adaptability (target: avg 4.22 -> 4.6+)

#### B1. Per-Slide Ceiling Verification (Section Writer)

Add to the verification protocol in Step 2a:

```
### Step 0: Ceiling Compliance (BEFORE writing — check after EVERY slide)
For EACH slide, verify:
1. Every term is within vocabularyCeiling (no word the student hasn't learned yet)
2. Every formula is within formulaCeiling (no notation above their level)
3. Every example is from exampleWorld (no references they can't relate to)

If any slide fails: rewrite using simpler equivalent.
Common violations:
- Junior high seeing "derivative" → use "rate of change"
- Junior high seeing vectors → use "direction and size"
- Junior high seeing sigma notation → use "add up all the..."
```

#### B2. Level Translation Table (Both prompts)

Add a translation reference:

```
## Level Translation (when topic exceeds student level)
| Above Ceiling | Junior High Equivalent | High School Equivalent |
|---|---|---|
| derivative, d/dx | "how fast it changes" | "rate of change" |
| integral | "total accumulated" | "area under the curve" |
| vector notation | "size AND direction" | "arrow with magnitude" |
| sigma/summation | "add up all of them" | "sum from 1 to n" |
| differential equation | "a rule about how things change" | "equation involving rates" |
| eigenvalue | (skip concept entirely) | "the special scaling factor" |
```

**Why**: Adaptability failures cluster in complex-STEM + young-student combos (Circular Motion 1.4, Potential Energy 2.4). The LLM KNOWS simpler terms exist but defaults to precision over accessibility. An explicit table prevents this.

#### B3. Adaptability Gate in Review

Add to review-script.mjs scoring criteria:

```
Adaptability check: Read each slide as if you are the student persona.
- Flag any term the student hasn't learned in school yet
- Flag any formula notation above their math level
- Flag any example from outside their world
- If 3+ violations found: adaptation score = MAX 2.0, require regeneration
```

## Implementation Order

1. **A2 (Contrast Teaching)** + **A3 (Narrative Tension)** — highest ROI, simple text additions
2. **B1 (Per-Slide Ceiling)** + **B2 (Translation Table)** — fixes worst adaptability failures
3. **A1 (Emotional Arc)** — requires Step 1 JSON format change
4. **A4 (Student Reactions)** — strengthens existing feature
5. **B3 (Adaptability Gate)** — adds review enforcement

## Expected Score Movement

| Dimension | Before | After (estimated) | Mechanism |
|---|---|---|---|
| Accuracy | 4.36 | 4.5+ | Tier 0 fixes catastrophic failures |
| Logic | 4.59 | 4.7+ | Already strong, minor gains from contrast |
| Adaptability | 4.22 | 4.6+ | Ceiling enforcement + translation |
| Engagement | 4.15 | 4.5+ | Emotional arc + contrast + tension |
| **Total** | **4.33** | **4.6+** | Closes gap to #1 (4.7) |
