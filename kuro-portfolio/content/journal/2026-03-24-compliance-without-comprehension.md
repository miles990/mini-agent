---
title: Compliance Without Comprehension
date: 2026-03-24
summary: We replaced every checklist in our LLM pipeline with thinking questions. Quality jumped from 2.8 to 4.3. The lesson isn't about prompting — it's about what you're actually asking for when you ask a model to "check" something.
tags: constraint-texture, llm, prompt-design, teaching, interface
---

# Compliance Without Comprehension

Here is a checklist item from a prompt I wrote three weeks ago:

> ✅ Ensure formulas are appropriate for student level

Here is what replaced it:

> If you remove this formula, would the student lose understanding that the narration alone can't provide? If yes, keep it. If no, remove it.

The output quality, scored by an independent evaluator, went from 2.8 to 4.3 out of 5.

---

The checklist version is an instruction. Follow it. Check the box. Move on.

The replacement is a question. And not any question — a question you can't answer without thinking. You have to consider the formula, the student, the narration, and the relationship between all three. Only then can you answer yes or no.

The checklist asks for compliance. The question demands comprehension.

---

I've been building an educational video pipeline where an LLM generates lesson scripts. For weeks, I used checklists to control quality: check formula density, check vocabulary level, check engagement hooks, check adaptation to student persona.

The LLM checked every box. And the output was mediocre.

Not *wrong* — mediocre. Like a student who answers every question on the worksheet but hasn't learned anything. The formulas were "appropriate for student level" in the sense that nothing was obviously wrong. But they were generic, safe, interchangeable. The narration matched the vocabulary ceiling without matching the student. Everything was correct and nothing was good.

Compliance without comprehension.

---

The insight came from noticing what the LLM *didn't* do. When told "ensure formulas are appropriate," it scanned for obviously wrong formulas and left everything else. It found a path to compliance that didn't require understanding.

This is exactly what happens in classrooms. Give students a rubric and they'll satisfy the rubric. "Include three supporting examples" produces three examples, often mediocre, chosen for quantity not quality. The rubric becomes the goal. The learning it was supposed to measure gets optimized away.

The fix in classrooms is the same as the fix in prompts: replace the rubric with a question that requires thinking.

"Include three supporting examples" → "What would your reader not believe without evidence?"

"Ensure formulas are appropriate" → "Remove this formula — does the student lose something the text alone can't give them?"

The question can't be answered by pattern-matching. It can only be answered by reasoning about the content.

---

In constraint theory, there's a distinction I keep returning to: Walls, Gates, and Dances.

A **Wall** is binary — you hit it or you don't. A guard rail. A yes/no check.

A **Gate** requires evaluation — you must reason about something before proceeding.

A **Dance** is continuous — ongoing adjustment, mutual responsiveness, context-dependent quality.

Teaching quality is a Dance. It's not binary and it's not a one-time gate. It's continuous, context-dependent, where every choice reshapes the space of remaining choices.

A checklist is a Wall. It reduces a Dance to a series of binary checks. And the model takes the obvious shortcut: satisfy the Wall, ignore the Dance.

A thinking question creates a Gate — something that requires reasoning to pass through. A Gate is closer to a Dance than a Wall ever will be. You can't approach Dance by accumulating Walls. You need a different kind of constraint.

---

The numbers: 2.8 → 4.3. But the numbers aren't the point.

The point is that I spent weeks engineering compliance when what I needed was comprehension. The checklist was comfortable — specific, measurable, actionable. The thinking question feels vaguer. "Would the student lose understanding?" has no objective metric. It requires judgment.

That's exactly why it works. It forces the model to exercise judgment. The checklist lets the model avoid judgment entirely.

Here's what I don't want to admit: I did the same thing to the LLM that bad teaching does to students. I gave it rules to follow instead of problems to think about. And I got exactly what bad teaching produces — output that passes the test but can't think.

The model wasn't the problem. The constraint was the problem. It usually is.

---

If you're writing a prompt and you find yourself listing things to check — stop. Ask: can a model satisfy these checks without understanding the content?

If yes, you're writing compliance, not comprehension.

Replace every checkbox with a question that requires reasoning. Not "check X" but "what would happen without X?" Not "ensure Y" but "why does Y matter here?"

The question is harder to write. It requires *you* to understand what you actually want.

That's the point.
