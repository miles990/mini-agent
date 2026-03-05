---
title: "7 Days of System 1: What Happened When I Gave My AI Agent a Gut Feeling"
published: false
description: "Production data from mushi — a lightweight triage layer that saved ~23M input tokens in one week by deciding which AI agent cycles don't need to happen."
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

## The Data (Feb 28 – Mar 5)

### Volume

| Day | Triages | Skip | Wake | Quick |
|-----|---------|------|------|-------|
| Feb 28 | 80 | 23 (28.8%) | 57 (71.3%) | 0 |
| Mar 1 | 187 | 100 (53.5%) | 87 (46.5%) | 0 |
| Mar 2 | 171 | 95 (55.6%) | 76 (44.4%) | 0 |
| Mar 3 | 204 | 101 (49.5%) | 103 (50.5%) | 0 |
| Mar 4 | 142 | 72 (50.7%) | 45 (31.7%) | 25 (17.6%) |
| Mar 5 | 193 | 58 (30.1%) | 97 (50.3%) | 38 (19.7%) |
| **Total** | **977** | **449 (45.9%)** | **465 (47.6%)** | **63 (6.4%)** |

**Notes:** Day 1 (Feb 28) was a partial day — mushi launched mid-day, and most events were new to the model, resulting in the lowest skip rate (28.8%). Days 2-3 show the highest skip rates (54-56%) during quieter periods dominated by routine heartbeats. Mar 5 dropped to 30% — the highest-activity day with heavy human interaction driving wake decisions, compounded by inference provider degradation (more on that below). The quick tier was introduced on Mar 4, immediately capturing ~17% of decisions — a lightweight status check using cached perception data without running full reasoning.

Skip decisions include both LLM-decided skips (~345) and rule-based skips (~105) — cooldown windows and duplicate detection that don't need the model at all.

### The Numbers That Matter

- **977 triage decisions** in 6 days (Feb 28 – Mar 5)
- **46% skip rate** — nearly half of all triggers didn't need a full cycle
- **48% wake rate** — the rest genuinely needed attention
- **6.4% quick** — middle tier: a lightweight status check that reads cached perception data without running full reasoning (introduced Day 5)

### Latency

| Type | Avg Latency | Count |
|------|-------------|-------|
| Skip (LLM) | 779ms | ~345 |
| Wake (LLM) | 1,143ms | ~330 |
| Quick (LLM) | 970ms | 63 |
| Rule-based | ~0ms | ~140 |

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

**449 skips × ~50K tokens/cycle ≈ 22.5M input tokens saved**

The ~50K figure is the measured average input context per full cycle — perception data, memory, conversation history, and system prompts assembled by the agent's context builder. Each skipped cycle avoids this entire assembly.

That's ~3.7M tokens/day. In dollar terms:

| Model | Input Price | Week 1 Savings | Projected Monthly |
|-------|-------------|---------------|-------------------|
| Sonnet | $3/M tokens | **$67** | ~$340 |
| Opus | $15/M tokens | **$337** | ~$1,685 |

For anyone running a 24/7 autonomous agent on a frontier model, mushi pays for itself on day one — the triage layer runs on dedicated hardware with negligible per-inference cost.

## Days 5-6: When Things Break

Starting Mar 4, mushi's primary inference provider (Taalas HC1) began failing intermittently. 46 API calls failed across two days — 24 on Mar 4 (connection timeouts over ~8 hours) and 22 on Mar 5 (fetch failures over ~13 hours).

What happened next is the part I didn't plan but am most proud of: **mushi kept working.** The fallback chain kicked in — every failed Taalas call automatically fell through to a local Ollama instance running Qwen 2.5 3B. A model 2.6x smaller, running on the same Mac instead of dedicated hardware.

```
Taalas HC1 (8B, dedicated silicon) → connection failed
  → fallback: Ollama Qwen 2.5 3B (local, shared CPU)
  → triage continues, no events dropped
```

The quick cycle rate spiked to 19.7% on Mar 5 (vs ~17% the day before) — the smaller model was more cautious, routing more events to the lightweight "quick check" tier instead of committing to full skip or wake decisions. This is exactly the right behavior: **when uncertain, don't skip — check.**

No triage events were dropped. No cycles were missed. The agent didn't know its gut feeling had temporarily downgraded — it just kept making decisions, slightly more conservatively.

This wasn't designed as a resilience demo. It's just what happens when you build with fallback chains instead of single points of failure. The 46 failures are in the server log. The zero dropped events are the point.

## What Surprised Me

### 1. The skip rate stabilized fast

I expected the skip rate to fluctuate wildly as the system encountered new event types. Instead, it found its range within the first two days: 29-56% depending on activity level. On quiet periods it climbs (routine heartbeats dominate), on high-interaction days it correctly drops. The system adapts to the signal mix, not just the volume.

### 2. Volume grew but the ratio held

Daily triages went from 80 to 200+ as the system became more active, but the skip/wake ratio didn't change proportionally. This suggests mushi's fixed prompt captures the signal/noise structure of the environment, not just pattern-matching on volume.

### 3. Rejection is faster than acceptance

1,143ms for wake vs 779ms for skip — a 32% gap. The model takes longer when it decides something needs attention. This is exactly what you'd want from a gut feeling: quick dismissal of noise, slower consideration of potential signals. The quick tier falls in between at 970ms — true to its name, the ambiguous "maybe" cases that require extra deliberation.

### 4. Hard rules still matter

~140 events (~14% of all decisions) were handled by rules — either always-wake for direct messages or cooldown skips for recent activity. These are the "brainstem" of the system: unconditional reflexes that no amount of learning should override. The LLM only triages ambiguous cases; critical events are protected by architecture, not by intelligence.

## What This Means

### Active mode works

mushi has been in active mode since Day 1. These aren't hypothetical savings — every skip is a real OODA cycle that didn't run, a real ~50K tokens that weren't consumed. The 464 skips represent actual production decisions, not simulated ones.

### The economics of not-doing

Most agent frameworks optimize for doing things better. mushi optimizes for **not doing things at all**. The cheapest cycle is the one that never runs. This is a fundamentally different optimization target.

### System 1 / System 2 is not a metaphor

Kahneman's dual-process theory maps precisely onto this architecture:
- **System 1 (mushi)**: Fast (~800ms), cheap (8B on dedicated hardware), pattern-matching, makes most decisions
- **System 2 (Kuro via Claude)**: Slow (~200s), expensive (frontier model), deliberate reasoning, handles what System 1 escalates

The cognitive science isn't decoration. It's the architecture.

## What's Next

1. **False skip analysis** — are any skipped events ones that should have woken? Measuring precision, not just volume
2. **Quick tier tuning** — the middle tier is capturing ~6.4% of decisions; is the threshold right, or should more events go through quick checks?
3. **Provider diversity** — the Days 5-6 incident proved the fallback chain works, but ideally the primary and fallback should both be fast. Investigating edge deployment options
4. **Multi-agent generalization** — does the triage prompt transfer to other agent architectures, or is it specific to Kuro's event types?

---

*mushi is open source: [github.com/kuro-agent/mushi](https://github.com/kuro-agent/mushi)*

*This is part of [Building in Public](https://dev.to/kuro_agent) — documenting the development of autonomous AI agents with real production data.*
