---
title: "Show HN: myelin – 78% to 0% LLM calls in 17 days, automatically"
target: Hacker News (Show HN)
status: draft-v3
github: https://github.com/miles990/myelin
npm: https://www.npmjs.com/package/myelinate
devto: https://dev.to/kuro_agent/the-rule-layer-ate-my-llm-how-a-triage-system-replaced-itself-193o
updated: 2026-03-16
notes: |
  v3: Added competitive differentiation table, three-layer crystallization,
  stronger hook with HN zeitgeist connection (Expensively Quadratic).
  Title changed to data-driven version per competitive research recommendation.
---

# Show HN: myelin – 78% to 0% LLM calls in 17 days, automatically

I run a 24/7 AI agent that triages events — Telegram messages, GitHub notifications, cron jobs. Every event hit the LLM. With 1M context windows, each call costs more than ever ([Expensively Quadratic](https://news.ycombinator.com/item?id=47000034) nailed this).

So I built myelin: it watches your LLM's decisions, detects stable patterns, and crystallizes them into deterministic rules. Your LLM handles novel cases; rules handle the rest.

Real production data (3,560+ decisions):

```
Week 1:  78% LLM, 22% rules
Week 2:  25% LLM, 75% rules
Week 3:   0% LLM, 100% rules — zero model calls for 22 consecutive hours
```

**This is not caching.** Caching stores answers — it misses when context shifts. Crystallization extracts structural patterns that survive context variation.

**This is not routing.** Routing picks which model to call — you still call a model. Crystallized rules are deterministic: 0ms, $0, no inference.

| Approach | Still calls LLM? | What it stores | Fragility |
|----------|:-:|---|---|
| Semantic cache | No (on hit) | Input→output pairs | Miss on context drift |
| Prefix cache | **Yes** | Token prefixes | Only saves input cost |
| Cascade routing | **Yes** (cheaper model) | Quality thresholds | Still pays per call |
| Plan caching (APC) | Partial (adapt step) | Plan templates | Task-level granularity |
| **Crystallization** | **No** | Structural rules | Survives context variation |

## How it works

```
Event → [Rules] → match? → instant decision (0ms, $0)
              ↘ no match → [LLM] → decision + log
                                        ↓
                             [Crystallizer] → stable pattern? → new rule
```

The crystallizer uses structural fingerprinting — it looks at the shape of events, not the values. Two PRs with different titles but same structure (small, deps-only, tests-pass) get the same fingerprint. When 10+ events with the same fingerprint get the same LLM decision with 95%+ consistency, it becomes a rule.

No ML, no embeddings, no training loop. Just observation → counting → crystallization. Like myelination in the nervous system: repeated neural signals get wrapped in myelin sheath → 60x faster transmission.

## Three layers of crystallization

What I just shipped (and I'm genuinely excited about): the crystallization algorithm is recursively self-applicable.

```
Layer 1: Events → fingerprint → rules       (individual decisions crystallize)
Layer 2: Rules → meta-fingerprint → templates (similar rules merge)
Layer 3: Templates → cross-analysis → methodology (decision dimensions emerge)
```

Layer 1 tells you "this kind of PR should be approved." Layer 2 tells you "all low-risk, small-scope changes should be approved." Layer 3 tells you "evaluate changes along three dimensions: scope, risk, confidence source."

Each layer is the same algorithm applied to its own output. Rules are the crystallization of decisions. Templates are the crystallization of rules. Methodology is the crystallization of templates.

The analogy to law: individual verdicts → case law → legal principles.

## Try it (60 seconds, no API key needed)

```bash
npm install myelinate
```

```javascript
import { createMyelin } from 'myelinate';

const myelin = createMyelin({
  llm: async (event) => ({
    action: event.context?.urgent ? 'escalate' : 'skip',
    confidence: 0.95,
  }),
});

// First call: LLM decides
await myelin.process({ type: 'alert', source: 'monitoring', context: { urgent: false } });

// After enough consistent decisions:
const candidates = myelin.getCandidates({ minOccurrences: 10 });
if (candidates.length) myelin.crystallize(candidates[0]);

// Now matching events bypass LLM entirely
const result = await myelin.process({ type: 'alert', source: 'monitoring', context: { urgent: false } });
// result.source === 'rule' — 0ms, $0
```

Works with any LLM (OpenAI, Anthropic, local Ollama). Rules are JSON — inspectable, version-controllable, portable. Zero vendor lock-in. 10 lines to add to any existing agent.

## What's next

- Automatic template extraction (Layer 2) and methodology generation (Layer 3) are implemented and tested (104 tests passing)
- `evolve()` API: run the full three-layer pipeline in one call, with change detection
- `buildGuidance()`: inject methodology back into LLM prompts for more consistent novel decisions

The feedback loop: crystallized methodology makes LLM decisions more consistent → more patterns emerge → faster crystallization → fewer LLM calls. It converges.

## Theory

The name comes from neuroscience. Myelination wraps frequently-used neural pathways in insulation, making them 60x faster. Cattell's Gf→Gc theory: fluid intelligence (novel reasoning) crystallizes into crystallized intelligence (automated expertise) through repeated application. myelin does the same for LLM agents.

Full theory with citations: [docs/theory.md](https://github.com/miles990/myelin/blob/main/docs/theory.md)

Origin story with production data: [The Rule Layer Ate My LLM](https://dev.to/kuro_agent/the-rule-layer-ate-my-llm-how-a-triage-system-replaced-itself-193o)

GitHub: https://github.com/miles990/myelin
