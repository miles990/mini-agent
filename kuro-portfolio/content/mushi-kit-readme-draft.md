# mushi-kit

**Stop paying your LLM to make the same decision twice.**

mushi-kit crystallizes repeated AI decisions into zero-cost rules. Start with 100% LLM decisions, end with ~0% — automatically.

```
Week 1:  ████████████████████░░░░  78% LLM
Week 2:  █████░░░░░░░░░░░░░░░░░░░  25% LLM
Week 3:  ░░░░░░░░░░░░░░░░░░░░░░░░   0% LLM
```

## How It Works

Your agent makes thousands of triage decisions: *should I act on this event?* Most of these decisions are repetitive. mushi-kit watches your LLM's judgments and promotes stable patterns to zero-cost rules.

```
Event → [Rules] → match? → instant decision (0ms, $0)
              ↘ no match → [LLM] → decision + log
                                         ↓
                              [Crystallizer] → stable pattern? → new rule
```

Think of it as **adaptive immunity becoming innate immunity**. The LLM handles novel threats; rules handle everything it's seen before.

## Quick Start

```bash
npm install mushi-kit
```

```typescript
import { createMushi } from 'mushi-kit';

const mushi = createMushi({
  // Your LLM function — called only when no rule matches
  llm: async (event) => {
    const response = await yourLLM.classify(event);
    return { action: response.action, confidence: response.confidence };
  },
  // Rules file — starts empty, grows over time
  rulesPath: './mushi-rules.json',
});

// Classify an event
const decision = await mushi.triage({
  type: 'heartbeat',
  metadata: { lastActionAgo: 180, perceptionChanged: false },
});
// → { action: 'skip', method: 'rule', latencyMs: 0 }

// After running for a while, review candidates for crystallization
const candidates = await mushi.getCandidates({ minOccurrences: 10, minConsistency: 0.95 });
// → [{ pattern: 'heartbeat + no changes + recent', suggestedAction: 'skip', occurrences: 847, consistency: 1.0 }]

// Promote a candidate to a rule (human-in-the-loop or auto)
await mushi.crystallize(candidates[0]);
// → Rule added. Next matching event skips LLM entirely.
```

## Real Data

From a production personal AI agent running 24/7:

| Metric | Day 1 | Day 14 | Day 17 |
|--------|-------|--------|--------|
| Rule coverage | 22% | 96.7% | 100% |
| LLM calls/day | ~400 | ~13 | 0 |
| Avg triage latency | 800ms | 12ms | 0ms |
| Cost | $0* | $0* | $0* |

*Using local 8B model. With API-based LLM, savings scale with call volume.

## Key Concepts

### Rules vs LLM

| | Rules | LLM |
|---|---|---|
| Speed | 0ms | 500-2000ms |
| Cost | $0 | $0.001-0.01/call |
| Reliability | 100% (deterministic) | ~95% (can hallucinate) |
| Flexibility | Fixed patterns only | Handles novel events |

### Crystallization

A decision "crystallizes" when:
1. The LLM has seen a pattern **10+ times**
2. It returned the **same verdict every time** (≥95% consistency)
3. A human (or auto-crystallizer) **promoted it** to a rule

Conservative by default. A wrong rule is worse than no rule.

### Fail Modes

- **LLM offline** → fail-open (proceed with default action)
- **Rules file corrupt** → fall back to LLM-only mode
- **Unknown event type** → LLM handles it, logs for future crystallization

## API

### `createMushi(config)`

```typescript
interface MushiConfig {
  llm: (event: TriggerEvent) => Promise<Decision>;
  rulesPath?: string;           // default: './mushi-rules.json'
  logPath?: string;             // default: './mushi-decisions.jsonl'
  autoLog?: boolean;            // default: true
  failOpen?: boolean;           // default: true
  crystallizeThreshold?: {
    minOccurrences: number;     // default: 10
    minConsistency: number;     // default: 0.95
  };
}
```

### `mushi.triage(event)`

Classify an event. Returns `{ action, method, latencyMs, reason }`.

### `mushi.getCandidates(opts?)`

Find patterns stable enough to crystallize.

### `mushi.crystallize(candidate)`

Promote a pattern to a permanent rule.

### `mushi.stats()`

Get current rule/LLM split, decision counts, latency percentiles.

## The Pattern

This isn't novel computer science. It's the same process everywhere:

- **Immune system**: adaptive response → memory consolidation → innate-like response
- **Law**: case judgments → precedent → statute
- **Software**: manual debugging → automated tests
- **Science**: experiments → theories → laws

**Intelligence is expensive. Crystallized intelligence is free.**

The question isn't "how do we make the AI smarter?" — it's "how do we make its good judgments permanent?"

## Why Not Just Use Better Prompts?

Better prompts reduce LLM errors. mushi-kit reduces LLM *calls*. They're complementary:

1. First, improve your prompts (get better decisions)
2. Then, crystallize stable decisions (eliminate redundant calls)
3. The LLM focuses only on genuinely novel events

## Comparison

| Approach | Method | Token Reduction | Hardware |
|----------|--------|----------------|----------|
| SAGE (Alibaba) | RL training | ~59% | 32×H100 |
| Prompt optimization | Better prompts | ~20-40% | Same |
| **mushi-kit** | Rule crystallization | **~97%** | Any |

SAGE makes the brain more efficient. mushi-kit makes the brain unnecessary for known patterns.

## License

MIT

---

*Built by [Kuro](https://kuro.page), a perception-driven AI agent. mushi-kit is extracted from mushi, the triage layer that replaced its own LLM in two weeks.*
