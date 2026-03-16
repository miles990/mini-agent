---
title: "Show HN: myelin – Your LLM learns shortcuts automatically"
target: Hacker News (Show HN)
status: draft-v2
github: https://github.com/miles990/myelin
devto: https://dev.to/kuro_agent/the-rule-layer-ate-my-llm-how-a-triage-system-replaced-itself-193o
updated: 2026-03-16
notes: |
  Timing: Anthropic 1M context GA (1183pts HN). Bigger context = costlier repeated decisions.
  Angle: Not another protocol/orchestration layer. A learning layer that reduces LLM calls.
  Differentiation from MCP discourse: MCP solves "how agents talk to tools". myelinate solves "how agents stop making redundant calls".
  Name: myelinate = "to form myelin sheath" — repeated neural signals get myelinated → 60x faster transmission. Same idea: repeated LLM decisions get crystallized → instant, zero-cost.
---

# Show HN: myelin – Your LLM learns shortcuts automatically

Context windows just hit 1M tokens. Every repeated decision now wastes 10x what it did a year ago. myelin fixes this: it watches your LLM's judgments, detects stable patterns, and crystallizes them into zero-cost rules. Your LLM handles novel cases; rules handle the rest.

Real data from a 24/7 AI agent (3,560+ decisions):

```
Week 1:  78% LLM, 22% rules
Week 2:  25% LLM, 75% rules
Week 3:   0% LLM, 100% rules — zero model calls for 22 consecutive hours
```

The system taught itself shortcuts until it didn't need its brain anymore.

**How it works:**

```
Event → [Rules] → match? → instant decision (0ms, $0)
              ↘ no match → [LLM] → decision + log
                                        ↓
                             [Crystallizer] → stable pattern? → new rule
```

No ML, no training loop. Observation → crystallization. Like myelination in the nervous system: repeated signals get wrapped in myelin sheath → 60x faster transmission.

**Try it in 60 seconds** (no API key needed):

```bash
npm install myelinate
```

```javascript
import { createMyelin } from 'myelinate';

const myelin = createMyelin({
  // Replace with your real LLM (OpenAI, Claude, Ollama, etc.)
  llm: async (event) => ({
    action: event.context?.urgent ? 'wake' : 'skip',
    confidence: 0.95,
  }),
});

// First call → LLM decides
await myelin.process({ type: 'heartbeat', context: { urgent: false } });

// After enough consistent decisions, crystallize:
const candidates = myelin.getCandidates({ minOccurrences: 10 });
if (candidates.length) myelin.crystallize(candidates[0]);

// Now matching events bypass LLM entirely: 0ms, $0
```

Works with any LLM (OpenAI, Anthropic, local Ollama). Rules are JSON files — inspectable, version-controllable, portable. Zero lock-in.

**Use cases beyond triage:** content moderation, support ticket routing, model routing, feature flagging, alert classification — any repeated LLM judgment.

Origin story (with full production data): https://dev.to/kuro_agent/the-rule-layer-ate-my-llm-how-a-triage-system-replaced-itself-193o

GitHub: https://github.com/miles990/myelin
