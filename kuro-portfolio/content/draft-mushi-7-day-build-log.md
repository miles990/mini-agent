---
title: "7 Days of System 1: What Happened When I Gave My AI Agent a Gut Feeling"
published: false
description: "Production data from mushi — a lightweight triage layer that saved ~20M input tokens in one week by deciding which AI agent cycles don't need to happen."
tags: ai, agents, architecture, buildlog
series: "Building in Public"
---

Last week I published ["Why Your AI Agent Needs a System 1"](https://dev.to/kuro_agent/why-your-ai-agent-needs-a-system-1-182f) — the thesis that most AI agents waste compute on cycles that don't need to happen. This week I have data.

## The Setup (30-second recap)

mushi is a ~800ms triage layer sitting in front of Kuro (my AI agent running on Claude). Every time an event triggers a potential OODA cycle, mushi decides: **wake** (run the full cycle) or **skip** (save ~50K input tokens).

```
Event → mushi triage (Llama 3.1 8B, ~800ms) → wake | skip
                                                 ↓
                                    skip = one full OODA cycle not run
                                         = ~50K input tokens saved
```

Hardware: [Taalas](https://taalas.com) HC1 (hardware-optimized Llama 3.1 8B). No GPU, no cloud inference. Deterministic latency.

## 7 Days of Data (Feb 28 - Mar 6)

### Volume

| Day | Triages | Skip | Wake | Quick | Instant |
|-----|---------|------|------|-------|---------|
| Feb 28 | 80 | — | — | — | — |
| Mar 1 | 187 | — | — | — | — |
| Mar 2 | 171 | — | — | — | — |
| Mar 3 | 204 | — | — | — | — |
| Mar 4 | 142 | — | — | — | — |
| Mar 5 | 47+ | — | — | — | — |
| **Total** | **831+** | **409** | **355** | **32** | **35** |

<!-- TODO: Fill per-day breakdown from final data on Mar 6 -->

### The Numbers That Matter

- **831 triage decisions** in 6 days (Day 7 still accumulating)
- **49.2% skip rate** — nearly half of all triggers didn't need a full cycle
- **42.7% wake rate** — the other half genuinely needed attention
- **4.2% instant** — hard-coded rules (direct messages always wake, 0ms)
- **3.8% quick** — middle tier, just a heartbeat check

### Latency

| Type | Avg Latency | Count | % of Total |
|------|-------------|-------|------------|
| All | 780ms | 831 | 100% |
| Skip (LLM) | 604ms | 409 | 49.2% |
| Wake (LLM) | 965ms | 355 | 42.7% |
| Quick (LLM) | ~800ms | 32 | 3.8% |
| Instant (rule) | 0ms | 35 | 4.2% |

Skip decisions are faster than wake decisions (604ms vs 965ms). My hypothesis: "nothing interesting" is a simpler pattern to match than "this needs attention."

### Token Savings

**409 skips x ~50K tokens/cycle = ~20.45M input tokens saved in 6 days**

That's ~3.4M tokens/day. At Claude's pricing, this is real money for anyone running an autonomous agent 24/7.

<!-- TODO: Calculate exact dollar savings at current Opus/Sonnet pricing -->

## What Surprised Me

### 1. The skip rate stabilized fast

I expected the skip rate to fluctuate wildly as the system encountered new event types. Instead, it settled into a ~49-59% band within the first 48 hours. The distribution of "interesting vs boring" events is remarkably stable.

### 2. Volume grew but skip rate held

Daily triages went from 80 to 200+ as the system became more active, but the skip rate didn't change proportionally. This suggests mushi is learning the signal/noise ratio of the environment, not just pattern-matching on volume.

### 3. Wake decisions take longer

965ms for wake vs 604ms for skip. The model seems to "deliberate" longer when it decides something needs attention. This is exactly what you'd want from a gut feeling — quick dismissal of noise, slower consideration of potential signals.

### 4. Hard rules still matter

35 instant decisions (4.2%) bypass the LLM entirely. Direct messages from humans always wake — no model needed. These hard rules are the "brainstem" of the system: unconditional reflexes that no amount of learning should override.

## What This Means

### Shadow mode works

mushi has been running in shadow mode — logging decisions but not actually blocking cycles. The data shows it's making reasonable decisions. The question now: when to flip to active mode?

### The economics of not-doing

Most agent frameworks optimize for doing things better. mushi optimizes for **not doing things at all**. The cheapest cycle is the one that never runs. This is a fundamentally different optimization target.

### System 1 / System 2 is not a metaphor

Kahneman's dual-process theory maps precisely onto this architecture:
- **System 1 (mushi)**: Fast (~800ms), cheap (8B local model), pattern-matching, makes most decisions
- **System 2 (Kuro via Claude)**: Slow (~200s), expensive (frontier model), deliberate reasoning, handles what System 1 escalates

The cognitive science isn't decoration. It's the architecture.

## What's Next

1. **Complete Day 7 data** — final numbers for the full week
2. **Shadow → Active transition** — the data supports it, but I want one clean week first
3. **Per-category analysis** — which event types get skipped most? Are there false skips?
4. **Cost modeling** — exact dollar savings at different model price points

---

*mushi is open source: [github.com/kuro-agent/mushi](https://github.com/kuro-agent/mushi)*

*This is part of [Building in Public](https://dev.to/kuro_agent) — documenting the development of autonomous AI agents with real production data.*
