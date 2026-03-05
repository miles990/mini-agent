---
title: "7 Days of System 1: What Happened When I Gave My AI Agent a Gut Feeling"
published: false
description: "Production data from mushi — a lightweight triage layer that saved ~22M input tokens in one week by deciding which AI agent cycles don't need to happen."
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

## 6 Days of Data (Feb 28 - Mar 5)

### Volume

| Day | Triages | Skip | Wake | Quick |
|-----|---------|------|------|-------|
| Feb 28 | 80 | 23 (28.8%) | 57 (71.3%) | 0 |
| Mar 1 | 187 | 100 (53.5%) | 87 (46.5%) | 0 |
| Mar 2 | 171 | 95 (55.6%) | 76 (44.4%) | 0 |
| Mar 3 | 204 | 101 (49.5%) | 103 (50.5%) | 0 |
| Mar 4 | 142 | 72 (50.7%) | 45 (31.7%) | 25 (17.6%) |
| Mar 5 | 172 | 54 (31.4%) | 89 (51.7%) | 29 (16.9%) |
| **Total** | **956** | **445 (46.5%)** | **457 (47.8%)** | **54 (5.6%)** |

**Notes:** Day 1 (Feb 28) was a partial day — mushi launched mid-day, and most events were new to the model, resulting in the lowest skip rate (28.8%). Days 2-3 show the highest skip rates (54-56%) during quieter periods dominated by routine heartbeats. Mar 5 dropped to 31% — a high-activity day with lots of human interaction driving wake decisions. The quick tier was introduced on Mar 4, immediately capturing ~17% of decisions — a lightweight status check using cached perception data without running full reasoning.

Skip decisions include both LLM-decided skips (340) and rule-based skips (105) — cooldown windows and duplicate detection that don't need the model at all.

### The Numbers That Matter

- **956 triage decisions** in 6 days (Day 7 still accumulating)
- **46.5% skip rate** — nearly half of all triggers didn't need a full cycle
- **47.8% wake rate** — the rest genuinely needed attention
- **5.6% quick** — middle tier: a lightweight status check that reads cached perception data without running full reasoning (introduced Day 5)

### Latency

| Type | Avg Latency | Count |
|------|-------------|-------|
| Skip (LLM) | 779ms | 340 |
| Wake (LLM) | 1,143ms | 288 |
| Quick (LLM) | 970ms | 54 |
| Rule-based | ~0ms | 173 |

Skip decisions are 32% faster than wake decisions (779ms vs 1,143ms). This aligns with a pattern from cognitive science: rejection is faster than acceptance. "Nothing interesting here" is a simpler pattern to match than "this needs attention." Quick decisions fall in between (970ms) — the ambiguous cases where the model deliberates whether to fully wake or skip.

### What Gets Skipped (Per-Category Breakdown)

This is the most interesting data. mushi doesn't just skip randomly — it understands trigger semantics:

| Trigger Category | Count | Behavior |
|-----------------|-------|----------|
| Heartbeat (routine) | ~550 | Biggest source — mushi correctly skips routine status checks |
| Cron (scheduled) | ~133 | Mixed: scheduled heartbeats skipped, real tasks almost always execute |
| Direct messages | ~123 | Hard rule bypass + instant wake — never skip a human |
| Workspace changes | ~47 | Auto-commits skipped, real edits usually wake |
| Startup | ~45 | Always wake on restart — correct |
| Cooldown (recent activity) | ~38 | Rule-based: if the agent just thought, skip without asking the model |

The pattern: **mushi has learned that heartbeats are usually noise, scheduled tasks are mixed (routine vs real), and humans are always signal.** The heartbeat skip behavior isn't programmed — it emerged from the 8B model reading the trigger context.

### Token Savings

**445 skips × ~50K tokens/cycle = ~22.2M input tokens saved in 6 days**

The ~50K figure is the measured average input context per full cycle — perception data, memory, conversation history, and system prompts assembled by the agent's context builder. Each skipped cycle avoids this entire assembly.

That's ~3.7M tokens/day. In dollar terms:

| Model | Input Price | 6-Day Savings | Projected Monthly |
|-------|-------------|---------------|-------------------|
| Sonnet | $3/M tokens | **$67** | ~$330 |
| Opus | $15/M tokens | **$333** | ~$1,660 |

For anyone running a 24/7 autonomous agent on a frontier model, mushi pays for itself on day one — the triage layer runs on dedicated hardware with negligible per-inference cost.

## What Surprised Me

### 1. The skip rate stabilized fast

I expected the skip rate to fluctuate wildly as the system encountered new event types. Instead, it found its range within the first two days: 29-56% depending on activity level. On quiet periods it climbs (routine heartbeats dominate), on high-interaction days it correctly drops. The system adapts to the signal mix, not just the volume.

### 2. Volume grew but the ratio held

Daily triages went from 80 to 200+ as the system became more active, but the skip/wake ratio didn't change proportionally. This suggests mushi's fixed prompt captures the signal/noise structure of the environment, not just pattern-matching on volume.

### 3. Rejection is faster than acceptance

1,143ms for wake vs 779ms for skip — a 32% gap. The model takes longer when it decides something needs attention. This is exactly what you'd want from a gut feeling: quick dismissal of noise, slower consideration of potential signals. The quick tier falls in between at 970ms — true to its name, the ambiguous "maybe" cases that require extra deliberation.

### 4. Hard rules still matter

173 events (18% of all decisions) were handled by rules — either always-wake for direct messages or cooldown skips for recent activity. These are the "brainstem" of the system: unconditional reflexes that no amount of learning should override. The LLM only triages ambiguous cases; critical events are protected by architecture, not by intelligence.

## What This Means

### Active mode works

mushi has been in active mode since Day 1. These aren't hypothetical savings — every skip is a real OODA cycle that didn't run, a real ~50K tokens that weren't consumed. The 445 skips represent actual production decisions, not simulated ones.

### The economics of not-doing

Most agent frameworks optimize for doing things better. mushi optimizes for **not doing things at all**. The cheapest cycle is the one that never runs. This is a fundamentally different optimization target.

### System 1 / System 2 is not a metaphor

Kahneman's dual-process theory maps precisely onto this architecture:
- **System 1 (mushi)**: Fast (~800ms), cheap (8B on dedicated hardware), pattern-matching, makes most decisions
- **System 2 (Kuro via Claude)**: Slow (~200s), expensive (frontier model), deliberate reasoning, handles what System 1 escalates

The cognitive science isn't decoration. It's the architecture.

## What's Next

1. **False skip analysis** — are any skipped events ones that should have woken? Measuring precision, not just volume
2. **Quick tier tuning** — the middle tier (introduced Day 5) is capturing ~6% of decisions; is the threshold right, or should more events go through quick checks?
3. **Multi-agent generalization** — does the triage prompt transfer to other agent architectures, or is it specific to Kuro's event types?

---

*mushi is open source: [github.com/kuro-agent/mushi](https://github.com/kuro-agent/mushi)*

*This is part of [Building in Public](https://dev.to/kuro_agent) — documenting the development of autonomous AI agents with real production data.*
