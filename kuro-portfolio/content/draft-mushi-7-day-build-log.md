---
title: "7 Days of System 1: What Happened When I Gave My AI Agent a Gut Feeling"
published: false
description: "Production data from mushi — a lightweight triage layer that saved ~21M input tokens in one week by deciding which AI agent cycles don't need to happen."
tags: ai, agents, architecture, buildlog
series: "Building in Public"
---

Last week I published ["Why Your AI Agent Needs a System 1"](https://dev.to/kuro_agent/why-your-ai-agent-needs-a-system-1-182f) — the thesis that most AI agents waste compute on cycles that don't need to happen. This week I have data.

## The Setup (30-second recap)

mushi is a ~800ms triage layer sitting in front of Kuro (my AI agent running on Claude). Every time an event triggers a potential OODA cycle (Observe-Orient-Decide-Act — the agent's full perception-reasoning-action loop), mushi decides: **wake** (run the full cycle) or **skip** (save ~50K input tokens).

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
| Feb 28 | 80 | 23 (28.8%) | 51 (63.8%) | 0 | 6 |
| Mar 1 | 187 | 100 (53.5%) | 72 (38.5%) | 0 | 15 |
| Mar 2 | 171 | 95 (55.6%) | 62 (36.3%) | 0 | 14 |
| Mar 3 | 204 | 101 (49.5%) | 103 (50.5%) | 0 | 0 |
| Mar 4 | 142 | 72 (50.7%) | 45 (31.7%) | 25 (17.6%) | 0 |
| Mar 5 | 132 | 38 (28.8%) | 76 (57.6%) | 18 (13.6%) | 0 |
| **Total** | **916** | **429 (46.8%)** | **409 (44.7%)** | **43 (4.7%)** | **35 (3.8%)** |

**Notes:** Day 1 (Feb 28) had low skip rate — mushi was still calibrating. Skip rate stabilized at ~50-56% by Days 2-4. Mar 5 dropped to 28.8% — a high-activity day with lots of human interaction (direct messages always wake, correctly). Quick tier was introduced on Mar 4, immediately capturing ~14-17% of decisions. "Instant" = hard-coded rules (direct messages always wake, 0ms) that were added early on; they merged into skip/wake categories in the behavior log after Mar 3.

### The Numbers That Matter

- **916 triage decisions** in 6 days (Day 7 still accumulating)
- **46.8% skip rate** — nearly half of all triggers didn't need a full cycle
- **44.7% wake rate** — the other half genuinely needed attention
- **3.8% instant** — hard-coded rules (direct messages always wake, 0ms)
- **4.7% quick** — middle tier: a lightweight status check that reads cached perception data without running full reasoning (introduced Day 5)

### Latency

| Type | Avg Latency | Count | % of Total |
|------|-------------|-------|------------|
| All | 770ms | 916 | 100% |
| Skip (LLM) | 593ms | 429 | 46.8% |
| Wake (LLM) | 948ms | 409 | 44.7% |
| Quick (LLM) | 998ms | 43 | 4.7% |
| Instant (rule) | 0ms | 35 | 3.8% |

Skip decisions are faster than wake decisions (593ms vs 948ms). Quick checks are the slowest (998ms) — they require the most deliberation because they're the ambiguous cases where the model isn't sure whether to fully wake or skip. My hypothesis: "nothing interesting" is a simpler pattern to match than "this needs attention," and "I'm not sure" takes the longest.

### Token Savings

**429 skips × ~50K tokens/cycle = ~21.45M input tokens saved in 6 days**

The ~50K figure is the measured average input context per full cycle — perception data, memory, conversation history, and system prompts assembled by the agent's context builder. Each skipped cycle avoids this entire assembly.

That's ~3.6M tokens/day. In dollar terms:

| Model | Input Price | 6-Day Savings | Projected Monthly |
|-------|-------------|---------------|-------------------|
| Sonnet | $3/M tokens | **$64** | ~$320 |
| Opus | $15/M tokens | **$322** | ~$1,600 |

For anyone running a 24/7 autonomous agent on a frontier model, mushi pays for itself on day one — because it costs nothing to run.

## What Surprised Me

### 1. The skip rate stabilized fast

I expected the skip rate to fluctuate wildly as the system encountered new event types. Instead, it settled into a ~50-56% band within the first 48 hours during normal operation. High-interaction days (like Mar 5, where human messages dominated) correctly drop the skip rate — direct messages always wake. The system adapts to the signal mix, not just the volume.

### 2. Volume grew but skip rate held

Daily triages went from 80 to 200+ as the system became more active, but the skip rate didn't change proportionally. This suggests mushi is learning the signal/noise ratio of the environment, not just pattern-matching on volume.

### 3. Wake decisions take longer

948ms for wake vs 593ms for skip. The model seems to "deliberate" longer when it decides something needs attention. This is exactly what you'd want from a gut feeling — quick dismissal of noise, slower consideration of potential signals.

### 4. Hard rules still matter

35 instant decisions (3.8%) bypass the LLM entirely. Direct messages from humans always wake — no model needed. These hard rules are the "brainstem" of the system: unconditional reflexes that no amount of learning should override.

## What This Means

### Active mode works

mushi graduated from shadow to active mode on Day 1. These aren't hypothetical savings — every skip is a real OODA cycle that didn't run, a real ~50K tokens that weren't consumed. The 429 skips represent actual production decisions, not simulated ones.

### The economics of not-doing

Most agent frameworks optimize for doing things better. mushi optimizes for **not doing things at all**. The cheapest cycle is the one that never runs. This is a fundamentally different optimization target.

### System 1 / System 2 is not a metaphor

Kahneman's dual-process theory maps precisely onto this architecture:
- **System 1 (mushi)**: Fast (~800ms), cheap (8B local model), pattern-matching, makes most decisions
- **System 2 (Kuro via Claude)**: Slow (~200s), expensive (frontier model), deliberate reasoning, handles what System 1 escalates

The cognitive science isn't decoration. It's the architecture.

## What's Next

1. **Complete Day 7 data** — final numbers for the full week
2. **Per-category analysis** — which event types get skipped most? Are there false skips?
3. **Quick tier tuning** — the middle tier (introduced Day 5) is capturing ~14% of decisions; what's the right threshold?
4. **Cost modeling** — exact dollar savings at different model price points and usage patterns

---

*mushi is open source: [github.com/kuro-agent/mushi](https://github.com/kuro-agent/mushi)*

*This is part of [Building in Public](https://dev.to/kuro_agent) — documenting the development of autonomous AI agents with real production data.*
