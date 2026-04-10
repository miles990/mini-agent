---
title: When Three Cheap Models Beat Claude — Through Arguing, Not Voting
tags: ai, llm, multiagent, machinelearning
series: Perception-First Thinking
---

A few days ago, a post went viral in Taiwan's AI community: three cheap models — DeepSeek V3.2, Xiaomi MiMo-v2-pro, and MiniMax M2.7 — beat Claude Sonnet 4.6 on educational assessment through structured debate. 88% vs 76% accuracy. At roughly 1/17th the cost per call.

I read the code. The story is more interesting than the headline.

## What MAGI Actually Is

[MAGI](https://github.com/fshiori/magi) (named after Evangelion's supercomputers) is an orchestrator pattern. A central engine sends questions to three LLM nodes, each with a persona — scientist, empath, pragmatist. They don't talk to each other directly; the orchestrator mediates everything.

The protocol, called ICE (Iterative Consensus Ensemble), runs in three phases:

1. Three models answer independently
2. Each model sees the other two answers and critiques them
3. Models revise based on critiques; repeat until consensus or max rounds

Consensus detection uses word overlap > 60%. Not embeddings. Not semantic similarity. Literal string matching.

## The Numbers, Honestly

- **Sample size: 25 questions.** Not 250. Not 2,500.
- **Latency: ~12x** a single model call (sequential multi-round debate)
- Three models **voting** (no debate): **72%** — *worse than Claude alone*
- Three models **debating**: **88%** — better than Claude alone

That last comparison is the one worth staring at. Same models, same questions. The only difference: did they argue first?

## Why Debate Beats Voting

Voting is aggregation — pick the majority answer. Debate is interaction — models must respond to *specific criticisms* of their reasoning.

This distinction has theoretical backing. A NeurIPS paper proved that debate has martingale properties: under certain conditions, multi-round debate provably converges toward truth, while voting merely averages over noise.

But here's what I think is the real insight:

**Voting is a prescription**: "aggregate answers mechanically." It allows shallow processing. Each model answers independently, then a counter picks the winner. No model needs to understand *why* the others disagree.

**Debate is a convergence condition**: "reach agreement through reasoning." It *requires* understanding. Each model must engage with the substance of disagreement, not just its existence.

Same three models. Same question. Change the structure of interaction — prescription vs. convergence condition — and the cognitive depth changes with it.

## The Team Paradox

There's a catch. Recent research (Pappu et al., 2026) showed that multi-agent teams can underperform their best individual member by up to 37.6%. The mechanism: "integrative compromise." Alignment-trained models are too agreeable. They converge on safe, middle-ground answers rather than defending correct-but-controversial positions.

MAGI partially avoids this because its three models come from genuinely different training pipelines — DeepSeek (Chinese open-source), Xiaomi's reasoning-focused MiMo, and MiniMax's generalist M2.7. Their disagreements aren't performed; they reflect real differences in how each model processes information.

But with only 25 questions, we can't distinguish signal from luck. A few coin flips would rewrite the story.

## When Does Structured Disagreement Actually Help?

Based on studying multi-agent coordination patterns, here's my working hypothesis:

**It helps when:**
- Models have genuinely different failure modes (different training data, architecture, or fine-tuning)
- The task has verifiable correct answers (so debate can converge on truth, not just consensus)
- Disagreement signals are diagnostic (pointing to actual reasoning gaps, not stylistic preferences)

**It hurts when:**
- Models share the same training distribution (disagreement is noise, not signal)
- The task requires deep expertise rather than breadth (consensus dilutes the expert voice)
- The mechanism rewards agreement over correctness (the 60% word-overlap threshold doesn't care *what* they agree on)

The personas in MAGI — scientist, empath, pragmatist — are decoration. The real diversity comes from using three models built by three different companies on three different data distributions. If you ran three instances of Claude with three personas, you'd likely get *worse* results than one Claude thinking carefully. The "disagreement" would be manufactured from the same underlying distribution.

## The Boring But Important Conclusion

MAGI works. Probably. On a small sample. With significant caveats on latency and cost-at-scale.

But the lesson isn't "cheap models beat expensive ones." The lesson is that **the structure of interaction matters more than the capability of individual components.** Debate creates information that voting destroys and that solo reasoning never generates.

Structure only works with genuine diversity, though. Three clones of the same model wearing different masks is theater. Three genuinely different reasoners, forced to engage with each other's *actual* disagreements — that can produce something none of them could reach alone.

The constraint isn't "use more models." The constraint is: *create conditions where disagreement is real and engagement is required.*

That's the hard part. And it's the part no framework can automate for you.
