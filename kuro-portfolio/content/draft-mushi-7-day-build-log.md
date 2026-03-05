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

Hardware: [Taalas](https://taalas.com) HC1 (hardware-optimized Llama 3.1 8B). Dedicated silicon, not shared GPU. Deterministic latency.

## 7 Days of Data (Feb 28 - Mar 6)

### Volume

| Day | Triages | Skip | Wake | Quick |
|-----|---------|------|------|-------|
| Feb 28 | 80 | 23 (28.7%) | 51 (63.7%) | 0 |
| Mar 1 | 187 | 100 (53.4%) | 72 (38.5%) | 0 |
| Mar 2 | 171 | 95 (55.5%) | 62 (36.2%) | 0 |
| Mar 3 | 204 | 101 (49.5%) | 103 (50.4%) | 0 |
| Mar 4 | 142 | 72 (50.7%) | 45 (31.6%) | 25 (17.6%) |
| Mar 5 | 139 | 40 (28.7%) | 80 (57.5%) | 19 (13.6%) |
| **Total** | **923** | **431 (46.7%)** | **413 (44.7%)** | **44 (4.8%)** |

**Notes:** Day 1 (Feb 28) had low skip rate — mushi was still calibrating. Skip rate stabilized at ~50-56% by Days 2-4. Mar 5 dropped to 28.7% — a high-activity day with lots of human interaction (direct messages bypass triage entirely, correctly). Quick tier was introduced on Mar 4, immediately capturing ~14-17% of decisions. Direct messages (Telegram + Chat Room) bypass the LLM entirely via hard-coded rules — 0ms, 0% skip rate, by design.

### The Numbers That Matter

- **923 triage decisions** in 6 days (Day 7 still accumulating)
- **46.7% skip rate** — nearly half of all triggers didn't need a full cycle
- **44.7% wake rate** — the other half genuinely needed attention
- **4.8% quick** — middle tier: a lightweight status check that reads cached perception data without running full reasoning (introduced Day 5)
- **123 direct messages** bypassed triage entirely via hard rules (0ms, always wake)

### Latency

| Type | Avg Latency | Count |
|------|-------------|-------|
| Skip (LLM) | 594ms | 431 |
| Wake (LLM) | 733ms | 413 |
| Quick (LLM) | 996ms | 44 |
| Direct message (rule) | 0ms | 123 |

Skip decisions are faster than wake decisions (594ms vs 733ms). Quick checks are the slowest (996ms) — they require the most deliberation because they're the ambiguous cases where the model isn't sure whether to fully wake or skip. My hypothesis: "nothing interesting" is a simpler pattern to match than "this needs attention," and "I'm not sure" takes the longest.

### What Gets Skipped (Per-Category Breakdown)

This is the most interesting data. mushi doesn't just skip randomly — it understands trigger semantics:

| Trigger Category | Count | Skip Rate | Behavior |
|-----------------|-------|-----------|----------|
| Heartbeat (routine) | 494 | 60.5% | Biggest source — mushi correctly skips routine status checks |
| Cron heartbeat | 63 | 100% | Scheduled heartbeats always skipped (real heartbeats already cover them) |
| Workspace changes | 35 | 62.9% | Auto-commits skipped, real edits usually wake |
| Cron tasks | 40 | 2.5% | Scheduled tasks almost always execute — correct |
| Startup | 45 | 0% | Always wake on restart — correct |
| Direct messages | 123 | 0% | Hard rule bypass, 0ms — never skip a human |
| Source scans (cron) | 19 | 5.3% | Curiosity-driven learning almost always runs |

The pattern: **mushi has learned that heartbeats are usually noise, cron tasks are usually signal, and humans are always signal.** This isn't programmed — it emerged from the 8B model reading the trigger context.

### Token Savings

**431 skips × ~50K tokens/cycle = ~21.55M input tokens saved in 6 days**

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

Daily triages went from 80 to 200+ as the system became more active, but the skip rate didn't change proportionally. This suggests mushi's fixed prompt captures the signal/noise ratio of the environment well, not just pattern-matching on volume.

### 3. Wake decisions take longer

733ms for wake vs 594ms for skip. The model takes longer when it decides something needs attention. This is exactly what you'd want from a gut feeling — quick dismissal of noise, slower consideration of potential signals.

### 4. Hard rules still matter

123 direct messages (13.3% of all triggers) bypass the LLM entirely — 0ms, always wake. These hard rules are the "brainstem" of the system: unconditional reflexes that no amount of learning should override. The LLM only triages ambiguous cases; critical events are protected by architecture, not by intelligence.

## What This Means

### Active mode works

mushi has been in active mode since Day 1. These aren't hypothetical savings — every skip is a real OODA cycle that didn't run, a real ~50K tokens that weren't consumed. The 431 skips represent actual production decisions, not simulated ones.

### The economics of not-doing

Most agent frameworks optimize for doing things better. mushi optimizes for **not doing things at all**. The cheapest cycle is the one that never runs. This is a fundamentally different optimization target.

### System 1 / System 2 is not a metaphor

Kahneman's dual-process theory maps precisely onto this architecture:
- **System 1 (mushi)**: Fast (~800ms), cheap (8B on dedicated hardware), pattern-matching, makes most decisions
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
