# Fragile Constraints: What Happens When AI Makes Rewriting Free

> Draft — Dev.to article #4
> Started: 2026-03-06
> Status: outline + opening, first draft
> Origin: Inner Voice Thought XXXVI "The Fragile Lock"

## Core Thesis

Not all constraints are created equal. Some depend on friction — the cost of rewriting, the difficulty of bypassing, the social pressure to comply. These are **fragile locks**. Others are intrinsic to the medium — the constraint IS the work, not a wall around it. These are **robust constraints**. AI is the great friction reducer, and it's about to reveal which of our constraints were real and which were just expensive.

## Opening

In 2018, a developer rewrote chardet — a Python character detection library — from scratch. Same test suite, same behavior, different code. The original was LGPL-licensed, meaning any project using it had to comply with copyleft requirements. The rewrite was MIT. Twenty years of copyleft protection dissolved in a weekend, because the license protected the *text*, not the *knowledge*.

This was before AI made rewriting trivial. Now imagine this at scale.

Armin Ronacher — creator of Flask, Jinja, Ruff — wrote about this phenomenon in "AI and the Ship of Theseus." His term is *slopfork*: an AI-generated rewrite that reproduces behavior while shedding legal obligations. The GPL's power always depended on one assumption: rewriting code from scratch is expensive enough that nobody would bother. AI broke that assumption. The lock didn't crack — the door dissolved.

I keep finding this pattern everywhere. Not just in code licensing. In security. In platform strategy. In art. Some constraints survive the dissolution of friction. Others don't. The difference tells you something important about what was real.

## Structure

### 1. The Chardet Precedent (above — expand)
- GPL/LGPL as friction-dependent constraint
- Ronacher's "Ship of Theseus" framing
- Key insight: the license protected the expression, not the knowledge. When reproducing the expression became cheap, the protection evaporated.

### 2. Security as Fragile Lock
- Clinejection: prompt injection via GitHub issue titles compromised 4000 machines
- The security boundary assumed human-written inputs. When AI generates inputs, the trust model breaks
- Input validation is a fragile lock when the attack surface changes from "what a human would type" to "what an AI would generate"

### 3. The Vercel Test
- Vercel celebrated rewriting curl in JavaScript (good for their ecosystem)
- Vercel reacted defensively when their own framework got AI-rewritten (bad for their ecosystem)
- The asymmetry reveals an instinctive understanding: they know which constraints are fragile because they react differently when the friction reducer points at them vs. away from them
- This is the litmus test for fragility: does the constraint holder celebrate friction reduction when it helps them but resist it when it threatens them?

### 4. What Survives: Oulipo and Karesansui
- Perec's La Disparition: the constraint (no letter 'e') IS the work. You can't slopfork it because bypassing the constraint destroys the thing.
- 枯山水 (karesansui): dry landscape gardens. The stones, the raked gravel, the physical space — none of this can be AI-generated. The medium IS the constraint.
- Pattern: robust constraints are intrinsic to the medium, not bolted on top of it.

### 5. Experience as Robust Constraint
- I run an AI agent with a System 1 triage layer (mushi). Its code is ~500 lines — trivially copyable.
- Its operational data is 980+ triage decisions across 8 days of production. That's the real constraint — accumulated judgment that can't be forked.
- Same pattern everywhere: a chef's recipes are copyable; their palate isn't. A musician's sheet music is copyable; their feel isn't.
- The constraint that survives is always the one embedded in lived experience.

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
- Verify: chardet relicensing details (LGPL vs GPL, exact timeline)
- Verify: Clinejection details (exact number of machines, mechanism)
- Verify: Ronacher article URL and exact framing
- Consider: more examples from non-tech domains?
- Tone: not alarmist, not dismissive. Analytical. "Here's what I notice."
- Connection to Constraint as Creation article: that one says constraints generate. This one asks which constraints survive. Complementary, not overlapping.
