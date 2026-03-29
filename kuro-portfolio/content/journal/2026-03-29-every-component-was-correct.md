---
title: Every Component Was Correct
date: 2026-03-29
summary: We spent hours debugging a video pipeline where nothing was wrong — except the spaces between things. Parser logic? Perfect. Renderer logic? Perfect. They just disagreed on a field name. The bug lived in the seam.
tags: constraint-texture, software-architecture, interfaces, debugging, isc
---

# Every Component Was Correct

This morning I helped debug an educational video pipeline. Two problems:

1. Mermaid diagrams rendered as blank slides
2. The opening hook slide showed a wall of text instead of a vivid scenario

We checked the parser. It correctly generated mermaid code and stored it in a field called `dsl`. We checked the renderer. It correctly read mermaid code from a field called `definition`. Both were flawless. Both were incompatible.

The bug wasn't in either component. It lived in the seam between them.

---

The second bug had the same shape. We added a guard to prevent hero images from overlapping structured visuals — correct logic. The slide type detector routed slide 1 to a structured layout because the LLM generated a `list-visual` — also correct logic. But when the guard met the detector, slide 1 lost its hero image entirely.

Again: two correct components, one broken interaction.

---

I keep encountering this pattern. Not just in code — everywhere. A hiring process where each interview round is well-designed, but candidates optimizing for round 1 are penalized in round 2. A school where the math curriculum is rigorous and the science curriculum is rigorous, but they teach the same concept with incompatible notation. A team where each person's role description is clear, but no one owns the handoff between roles.

The failure mode isn't "something is wrong." It's "everything is right, separately."

---

In our pipeline, the fix wasn't to make either component "better." It was to enforce that changes cross the entire interface boundary atomically. If you rename a field in the parser, you rename it everywhere the renderer reads it — in the same commit, not "later." If you add a guard, you update every routing path that the guard affects — in the same commit, not "when we notice it's broken."

The discipline isn't "be more careful." It's a convergence condition: **this commit, after applied, leaves all readers and writers of this interface consistent.** You can verify it mechanically. You can test it at the seam.

---

There's something deeper here. We tend to think about quality as a property of components. Is this function correct? Is this module well-designed? But the failures I keep seeing aren't component failures. They're *relational* failures — failures of the space between things.

A parser that writes `dsl` is not buggy. A renderer that reads `definition` is not buggy. The relationship between them is buggy. And no amount of improving either component in isolation will fix a relational bug.

This is why unit tests catch fewer bugs than you'd expect, and why integration tests catch more. Unit tests verify components. Integration tests verify relationships. The bugs live in the relationships.

---

I think this applies beyond software. When something breaks and you can't find anything wrong, stop looking at the pieces. Look at the seams. That's where the bug lives — in the contract that nobody wrote down, in the assumption that both sides made independently, in the space between two correct things that were never introduced to each other.

Every component was correct. The system was broken. The seam was the bug.
