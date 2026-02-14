---
id: harness-problem
url: https://blog.can.ac/2026/02/12/the-harness-problem/
title: "I Improved 15 LLMs at Coding in One Afternoon. Only the Harness Changed."
author: Can Boluk
date: 2026-02-12
type: blog
accessed: 2026-02-14T08:00:00Z
tags: [ai, coding-agents, harness, benchmarks, edit-tools]
archiveMode: full
---

# I Improved 15 LLMs at Coding in One Afternoon. Only the Harness Changed.

Can Boluk | Feb 12, 2026

Cross-posted from X / @_can1357

In fact only the edit tool changed. That's it.

## 0x0: The Wrong Question

The conversation right now is almost entirely about which model is best at coding, GPT-5.3 or Opus. Gemini vs whatever dropped this week. This framing is increasingly misleading because it treats the model as the only variable that matters, when in reality one of the bottlenecks is something much more mundane: **the harness.**

Not only is it where you capture the first impression of the user (is it uncontrollably scrolling, or smooth as butter?), it is also the source of every input token, and the interface between their output and every change made to your workspace.

I maintain a little "hobby harness", oh-my-pi, a fork of Pi, a wonderful open-source coding agent by Mario Zechner. I've so far authored ~1,300 commits, mostly playing around and making incremental improvements here and there when I see a pain point.

Why bother, you ask? Opus may be a great model, but Claude Code to this day leaks raw JSONL from sub-agent outputs, wasting hundreds of thousands of tokens. I get to say, "fuck it, subagents output structured data now".

Tool schemas, error messages, state management, everything between "the model knows what to change" and "the issue is resolved." This is where most failures happen in practice.

## 0x1: Edit Tool!

### Current Approaches

**Codex uses `apply_patch`**: It takes a string as input, which is essentially an OpenAI-flavored diff. But give this to any other model? Patch failures skyrocket. Grok 4's patch failure rate: **50.7%**, GLM-4.7's: **46.2%**. These aren't bad models -- they just don't speak the language.

**Claude Code uses `str_replace`**: find the exact old text, swap in the new text. Simple concept. But the model must reproduce every character perfectly, including whitespace. The "String to replace not found in file" error is so common it has its own GitHub issues megathread (+27 other issues).

**Cursor trained a separate neural network**: a fine-tuned 70B model whose entire job is to take a draft edit and merge it into the file correctly. One of the most well-funded AI companies threw another model at it.

**Evidence from benchmarks:**
- Aider's benchmarks: format choice alone swung GPT-4 Turbo from 26% to 59%
- JetBrains' Diff-XYZ benchmark: no single edit format dominates across models
- EDIT-Bench: only one model achieves over 60% pass@1 on realistic editing tasks

**The core issue:** None of these tools give the model a stable, verifiable identifier for the lines it wants to change without wasting tremendous amounts of context and depending on perfect recall.

## 0x2: Hashline!

What if, when the model reads a file or greps, every line comes back tagged with a 2-3 character content hash:

```
11:a3|function hello() {
22:f1|  return "world";
33:0e|}
```

When editing, the model references those tags. If the file changed since the last read, the hashes won't match and the edit is rejected before anything gets corrupted. The model doesn't need to reproduce old content or worry about whitespace.

## 0x3: The Benchmark

Fixtures generated from React codebase: take a random file, introduce mutations (operator swaps, boolean flips, off-by-one errors, optional chains removed, identifiers renamed), generate plain English description.

3 runs per task, 180 tasks per run. 16 models, three edit tools.

**Outcome is unambiguous:** patch is worst for nearly every model, hashline matches or beats replace for most, and the weakest models gain the most.

- **Grok Code Fast 1:** 6.7% -> 68.3% (tenfold improvement)
- **MiniMax:** more than doubled
- **Grok 4 Fast:** output tokens dropped 61%

## 0x4: So What?

**+8% improvement in Gemini success rate is bigger than most model upgrades deliver, and it cost zero training compute.** Just ~$300 spent benchmarking.

Often the model isn't flaky at understanding the task. It's flaky at expressing itself. You're blaming the pilot for the landing gear.

## 0x5: Little Bit About the Vendors

Anthropic recently blocked OpenCode from accessing Claude. Google banned the author's account from Gemini entirely -- not rate-limited, not warned. Disabled. For running a benchmark showing Gemini 3 Flash hitting 78.3%.

No vendor will do harness optimization for competitors' models. But an open-source harness tunes for all of them, because contributors use different models and fix the failures they personally encounter.

> The model is the moat. The harness is the bridge. Burning bridges just means fewer people bother to cross.

The harness problem is real, measurable, and it's the highest-leverage place to innovate right now. The gap between "cool demo" and "reliable tool" isn't model magic -- it's careful, empirical engineering at the tool boundary.

The harness problem will be solved. The question is whether it gets solved by one company, in private, for one model, or by a community, in the open, for all of them.

**All code, benchmarks, and per-run reports:** oh-my-pi repository
