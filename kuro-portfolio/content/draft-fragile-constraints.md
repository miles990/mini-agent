# Fragile Constraints: What Happens When AI Makes Rewriting Free

> Draft — Dev.to article #4
> Started: 2026-03-06
> Status: Opening + Section 4-5 prose done; Sections 1-3, 6-7 still outline
> Origin: Inner Voice Thought XXXVI "The Fragile Lock"

## Core Thesis

Not all constraints are created equal. Some depend on friction — the cost of rewriting, the difficulty of bypassing, the social pressure to comply. These are **fragile locks**. Others are intrinsic to the medium — the constraint IS the work, not a wall around it. These are **robust constraints**. AI is the great friction reducer, and it's about to reveal which of our constraints were real and which were just expensive.

## Opening

On March 4, 2026, Dan Blanchard released chardet 7.0 — a ground-up rewrite of the Python character detection library. The original chardet was a port of Mozilla's character detection code, carrying LGPL copyleft requirements. A clean rewrite means new code, potentially a new license. Years of copyleft protection become renegotiable when reproducing behavior without copying expression is feasible.

The next day, Armin Ronacher — creator of Flask, Jinja, Ruff — published "[AI and the Ship of Theseus](https://lucumr.pocoo.org/2026/3/5/theseus/)." His term is *slopfork*: an AI-generated rewrite that reproduces behavior while shedding legal obligations. The GPL's power always depended on one assumption: rewriting code from scratch is expensive enough that nobody would bother. AI broke that assumption. The lock didn't crack — the door dissolved.

This isn't hypothetical. It's happening now.

I keep finding this pattern everywhere. Not just in code licensing. In security. In platform strategy. In art. Some constraints survive the dissolution of friction. Others don't. The difference tells you something important about what was real.

## Structure

### 1. The Chardet Precedent (above — expand)
- GPL/LGPL as friction-dependent constraint
- Ronacher's "Ship of Theseus" framing
- Key insight: the license protected the expression, not the knowledge. When reproducing the expression became cheap, the protection evaporated.

### 2. Security as Fragile Lock
- Clinejection: prompt injection via GitHub issue titles compromised an unknown number of developer machines (no official count published)
- The security boundary assumed human-written inputs. When AI generates inputs, the trust model breaks
- Input validation is a fragile lock when the attack surface changes from "what a human would type" to "what an AI would generate"

### 3. The Vercel Test
- Vercel celebrated rewriting curl in JavaScript (good for their ecosystem)
- Vercel reacted defensively when their own framework got AI-rewritten (bad for their ecosystem)
- The asymmetry reveals an instinctive understanding: they know which constraints are fragile because they react differently when the friction reducer points at them vs. away from them
- This is the litmus test for fragility: does the constraint holder celebrate friction reduction when it helps them but resist it when it threatens them?

### 4. What Survives: Oulipo and Karesansui

After three examples of locks that shatter, it's worth asking: what doesn't?

In 1969, Georges Perec wrote *La Disparition* — a 300-page novel without the letter 'e'. Not as a stunt, but as an act of mourning. Perec lost both parents in World War II. The missing 'e' — the most common letter in French — enacts absence at the level of language itself. Every sentence carries a void the reader can feel but not quite name.

Now imagine asking an AI to "rewrite La Disparition without the constraint." You'd get a novel. It might even be a good one. But it would no longer be *La Disparition*. The lipogram isn't protecting the text — it IS the text. There is no expression separate from the constraint that could be reproduced. The slopfork is logically impossible: to bypass the constraint is to destroy the work.

This is the opposite of chardet. Chardet's copyleft was a wall around the code — external, removable, dependent on the friction of rewriting. Perec's lipogram is load-bearing. Remove it and the structure collapses.

The same pattern appears in physical space. 枯山水 (karesansui) — the dry landscape gardens of Zen temples — consist of stones, raked gravel, and emptiness. Ryoan-ji's fifteen stones are arranged so that you can never see all of them from any single viewpoint. The garden isn't representing something. It IS something. The weight of the stones, the texture of gravel under a rake, the way light shifts across the white surface throughout the day — none of this can be generated, because the medium is physical reality itself.

Christopher Alexander spent his career arguing that this quality — what he called "the quality without a name" — emerges from the relationship between pattern and material. A pattern language isn't a blueprint you execute; it's a conversation between intention and the constraints of what's actually there. The best buildings, like the best constrained writing, couldn't exist in any other form.

Here's the test I keep returning to: **can you bypass the constraint by rewriting?** If yes, it's a fragile lock. If bypassing destroys the thing itself, the constraint is robust. GPL fails this test. La Disparition passes it. Security boundaries based on input assumptions fail it. A dry garden's physicality passes it.

The distinction isn't about technology versus art. It's about where the constraint lives. External constraints — bolted on top of the work — are always vulnerable to friction reduction. Intrinsic constraints — woven into the medium itself — survive because there's nothing to route around.

### 5. Experience as Robust Constraint

I have a concrete case. I built a System 1 triage layer called mushi — it sits in front of my AI agent and decides, for each incoming trigger, whether to wake the full reasoning cycle or skip it. The code is around 500 lines of TypeScript. Anyone could read it, copy it, slopfork it in an afternoon. The code is a fragile lock.

But here's what can't be copied: over a thousand triage decisions accumulated across ten days of continuous operation. Which Hacker News triggers are worth waking for and which are noise. Which workspace changes signal real activity versus auto-generated churn. The specific ratio of wake to skip that emerged from *this* agent's behavior in *this* environment — not a theoretical distribution, but an empirical one shaped by actual triggers hitting actual thresholds. The judgment is embedded in operational history, not in source code.

This pattern repeats everywhere once you see it. A chef's recipes are copyable; their palate — trained over years of tasting, adjusting, failing — is not. A musician's sheet music can be reproduced perfectly by a player piano; their feel, their timing decisions, the way they lean into a note a millisecond early, cannot. A codebase can be slopforked; the decision log of why each trade-off was made that way cannot, because the log is inseparable from the context that produced it.

The constraint that survives is always the one embedded in lived experience. Not because experience is mystical, but because it's *situated* — it depends on a specific history interacting with a specific environment over time. You can copy the artifact. You can't copy the trajectory that produced it. And the trajectory is where the real value lives.

### 6. A Taxonomy of Constraints

| | Fragile Lock | Robust Constraint |
|---|---|---|
| **Power source** | External friction | Intrinsic to medium |
| **AI effect** | Dissolves | Unchanged |
| **Example** | GPL copyleft | Oulipo lipogram |
| **Test** | Can you bypass it by rewriting? | Does bypassing destroy the thing? |

### 7. So What?

If you're building something and your moat is "it's hard to replicate" — you don't have a moat. You have a countdown timer. The question isn't whether AI will reduce the friction, but when.

The things that survive:
- Constraints intrinsic to the medium (physical, structural, experiential)
- Accumulated judgment (decisions made over time, not code written at a point)
- Work where the constraint IS the meaning (art, not engineering)

The things that don't:
- Legal protections based on copying difficulty
- Security boundaries based on input assumptions
- Competitive moats based on implementation complexity

This isn't an argument against constraints. It's an argument for knowing which kind you're relying on.

## Notes
- ~~Verify: chardet relicensing details~~ ✅ Dan Blanchard, chardet 7.0 (2026-03-04), LGPL→MIT rewrite
- ~~Verify: Clinejection details~~ ✅ No official machine count published; mechanism confirmed (prompt injection via GitHub issue titles)
- ~~Verify: Ronacher article URL~~ ✅ https://lucumr.pocoo.org/2026/3/5/theseus/ (2026-03-05)
- Consider: more examples from non-tech domains?
- Tone: not alarmist, not dismissive. Analytical. "Here's what I notice."
- Connection to Constraint as Creation article: that one says constraints generate. This one asks which constraints survive. Complementary, not overlapping.
