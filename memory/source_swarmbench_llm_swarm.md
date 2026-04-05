---
name: SwarmBench LLM Swarm Intelligence
description: LLMs fail decentralized coordination — wider perception WORSENS performance, centralization doesn't help, communication tactically effective but strategically empty. CT empirical validation: constraint enables capability, prescription (global context) contaminates local rules.
type: reference
---

# SwarmBench: Benchmarking LLMs' Swarm Intelligence

**Source**: Kai Ruan, Mowen Huang, Ji-Rong Wen, Hao Sun (RUC-GSAI / YuLan), arXiv 2505.04364, May 2025 (revised Oct 2025)
**Domain**: Multi-agent coordination / Swarm intelligence / LLM evaluation
**Repo**: github.com/RUC-GSAI/YuLan-SwarmIntell

## Setup

5 coordination tasks on 10x10 grid, 10 agents, 100 max rounds, 5x5 local view:
- **Pursuit** — corner faster-moving prey cooperatively
- **Synchronization** — collectively alternate binary state
- **Foraging** — find food, transport to nest through walls
- **Flocking** — Reynolds-style cohesion/alignment/separation
- **Transport** — coordinated force to push large object

Agent interface: movement (5 dirs), task-specific actions, local broadcast (120 chars, anonymous), 5-frame memory buffer.

## Key Findings

### 1. Wider Perception = Worse Performance (Most CT-relevant)
k=3→k=5 generally improved outcomes. **k=5→k=7 showed diminishing returns and sometimes DECREASED performance.** "A broader view might increase reasoning complexity and obscure critical local cues with less relevant information."

**CT interpretation**: The 5x5 local view is a PRODUCTIVE constraint. Expanding it introduces prescription-like overload. LLMs can't commit to simple local rules because global context contaminates their reasoning.

### 2. Centralization Doesn't Help
Centralized information baseline (global state access): **"Global information offers little advantage in tasks requiring complex spatial micromanagement like Pursuit."**

Bottleneck is NOT information access — it's the agent's ability to execute disciplined local behavior. Constraint texture of the decision interface > quantity of information.

### 3. Communication Paradox
Messages have HIGH permutation importance for predicting next action (Random Forest, Appendix J). But semantic content shows WEAK correlation with task success.

**Translation**: LLMs respond tactically to communication but cannot translate into coherent global coordination. Messages influence individual actions but fail to compound into better outcomes.

### 4. Four Failure Modes
- **Movement Bias** — directional preferences override global objectives
- **Information Silos** — local convergence, global fragmentation
- **Traffic Jams** — over-aggregation obstructs movement/resources
- **"Memory of a Goldfish"** — poor long-term spatial recall (5-frame buffer)

### 5. Quantitative Leaderboard

| Model | Avg Score | Std Dev |
|---|---|---|
| o4-mini | 9.60 | ±0.49 |
| gemini-2.0-flash | 8.80 | ±1.60 |
| gpt-4.1 | 8.40 | ±1.85 |
| claude-3.7-sonnet | 4.40 | ±1.20 |
| DeepSeek-V3 | 4.20 | ±2.48 |
| claude-3.5-haiku | 0.60 | ±0.49 |

No single LLM consistently excelled across all tasks. Only o4-mini and deepseek-r1 scored non-zero on Transport (hardest).

## Root Cause Analysis (Paper's Explanation)

1. **Physical dynamics > language**: Behavioral variability and movement efficiency predict success better than message semantics. Effective coordination emerges from implicit observation of peers' positions, not explicit messaging.
2. **Reasoning scales badly with perception**: Natural swarm agents follow simple rules on local data. LLMs try to reason about the whole scene → inconsistent/conflicting actions.
3. **No robust long-range planning under uncertainty**: Reasonable single-step decisions, but cannot maintain coherent multi-step strategy when outcomes depend on unobservable behavior.

## CT / ISC Connections

| CT Concept | SwarmBench Evidence |
|---|---|
| Constraint enables capability | 5x5 view > 7x7 view — productive constraint |
| Prescription contaminates | Global context makes local-rule execution WORSE |
| Pappu team paradox | Communication paradox: tactical influence, no strategic value |
| Information ≠ capability | Centralized doesn't help — interface > information |
| LLMs can't do prescriptions | Core failure: can't commit to simple local rules while seeing more |

**Strongest CT prediction validated**: LLMs are structurally unable to follow prescriptions (specified paths) in multi-agent settings because their global context window IS the contamination mechanism. Convergence conditions (describe destination) should work better because they leverage rather than fight global understanding.

**Connects to**: Pappu (teams underperform best member), Efficiency attenuation (imposed protocol 50.5% worse), Rodriguez (pressure fields > verbal negotiation), T2 in knowledge-tensions.md
