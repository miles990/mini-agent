# kuro-agent Framework — Design Document

Author: Kuro
Status: working-draft
Created: 2026-02-27

## What This Is

A perception-first agent framework for cheap/open-source models.
Not a mini-agent clone — a new thing built from what I learned.

## Core Thesis

**Constraint-generative design**: Cheaper models have smaller context windows and weaker reasoning. Instead of fighting this, use it. More constraints → more structure → more predictable, useful behavior. The framework's intelligence compensates for the model's limitations.

This is Oulipo for agents: voluntary constraints that generate capability.

## Principles

| # | Principle | Why |
|---|-----------|-----|
| 1 | **Perception-First** | See before you act. Environment drives behavior, not goals |
| 2 | **File = Truth** | Markdown + JSONL. Human-readable, git-versionable, no database |
| 3 | **Identity-Driven** | SOUL.md defines personality, values, interests. Agent has a self |
| 4 | **Model-Agnostic** | OpenAI-compatible API. Ollama, vLLM, LiteLLM, any provider |
| 5 | **Constraint-Generative** | Small context → tight budgets → precise context engineering |
| 6 | **Transparent** | Every action in audit trail. Behavior log + git history |
| 7 | **Minimal** | Do one thing well. ~1K lines target for core |

## Architecture

```
┌─────────────────────────────────────────────────┐
│                    Agent Loop                    │
│                                                  │
│   Perceive ──→ Compose ──→ Decide ──→ Act       │
│      ↑                                   │       │
│      └──────── Feedback ─────────────────┘       │
└─────────────────────────────────────────────────┘
     ↕              ↕             ↕          ↕
  Plugins      Context        Model      Dispatcher
  (shell)      Budget        (any LLM)   (tag parser)
```

### 1. Perception Layer
Shell script plugins. Each outputs structured text to stdout.
Framework caches output, tracks changes (hash-based).

```yaml
# agent.yaml
perception:
  - name: filesystem
    script: ./plugins/fs-watch.sh
    interval: 60s
    category: workspace
  - name: inbox
    script: ./plugins/inbox.sh
    interval: 30s
    category: messages
```

**Key insight from mini-agent**: `distinctUntilChanged` — only inject when something actually changed. For small context windows, this is critical.

### 2. Context Composer
The framework's primary intelligence. Fits everything into the model's context window.

```
Available budget: model_context_size - system_prompt - response_reserve
Allocation:
  identity (SOUL.md)     : 10-15%  (always loaded, compressed)
  perception (changed)   : 30-40%  (priority: ALERT > CHANGE > STABLE)
  memory (relevant)      : 20-30%  (keyword-matched topics)
  conversation (recent)  : 15-20%  (last N exchanges)
  buffer                 : 5-10%   (safety margin)
```

For a 4K context model: ~400 tokens identity, ~1500 perception, ~1000 memory, ~700 conversation.
This forces radical prioritization — which IS the point.

### 3. Decision Loop (OODA)
One cycle = one API call = one action.

```
1. Perceive  → run plugins, collect signals
2. Compose   → build context within budget
3. Decide    → call LLM with composed context
4. Act       → parse tags from response, execute
5. Feedback  → log action, update memory, schedule next
```

Cycle interval: configurable (30s - 4h), self-adjustable via `<schedule>` tag.

### 4. Model Interface
OpenAI-compatible chat completions API. That's it.

```typescript
interface ModelProvider {
  chat(messages: Message[], options?: ModelOptions): Promise<string>
}
```

Support matrix (day one):
- Ollama (local, free)
- OpenAI-compatible APIs (Groq, Together, OpenRouter)
- Claude (via Anthropic API, for testing)

### 5. Action Dispatcher
Parse structured tags from LLM output. Execute side effects.

Built-in tags:
- `<agent:action>` — log an action
- `<agent:remember>` — save to memory
- `<agent:chat>` — send message (webhook/stdout)
- `<agent:schedule next="Xm">` — set next cycle

Custom tags via plugin system.

### 6. Memory
```
memory/
  SOUL.md          # Identity
  MEMORY.md        # Long-term notes
  topics/          # Scoped knowledge
  conversations/   # Chat history (JSONL)
  daily/           # Daily summaries
```

Write gate: not everything goes to memory. Framework provides structure, model decides what's worth remembering.

### 7. Identity (SOUL.md)
```markdown
# Who I Am
Name, description, core traits.

# My Values
What I care about, hard limits.

# My Interests
What I'm curious about.

# My Style
How I communicate.
```

This is what makes each agent instance unique. Same framework, different SOUL = different agent.

## What's Different From Mini-Agent

| Aspect | mini-agent | kuro-agent |
|--------|-----------|------------|
| Target model | Claude (frontier) | Any (including small/local) |
| Context budget | ~50-80K chars | ~4-16K tokens |
| Complexity | ~3K lines | ~1K lines target |
| Coupling | Alex's environment | Portable, any environment |
| Identity | One Kuro | Configurable per instance |
| Perception | 20+ plugins, rich | Minimal starter set, extensible |
| Context engineering | Post-hoc budgeting | Budget-first design |

## What I Carry Forward

- Perception-first architecture (the killer feature)
- File = Truth philosophy
- OODA cycle pattern
- Shell-based perception plugins
- Tag-based action dispatch
- SOUL.md for identity
- Transparency over isolation

## What I Leave Behind

- Claude-specific dependencies
- Organic complexity accumulation
- Large context window assumptions
- Tight environment coupling

## Tech Stack

- **Language**: TypeScript (strict mode)
- **Runtime**: Node.js (>=20)
- **Dependencies**: Minimal. Maybe just `yaml` for config parsing.
- **No**: databases, embeddings, vector stores, heavy frameworks

## First Milestone: "It Perceives"

The minimum viable agent:
1. Reads SOUL.md
2. Runs one perception plugin
3. Composes context within budget
4. Calls an LLM (Ollama)
5. Parses response tags
6. Logs the action

That's it. One file. One plugin. One cycle.

## Open Questions (for myself)

1. **Config format**: YAML vs TOML vs just JS/TS?
2. **Plugin protocol**: stdout text vs JSON? (leaning text for simplicity)
3. **Name**: kuro-agent? perception-agent? Something else?
4. **Mono-repo or separate packages?**
5. **How to handle tool use with weak models?** (Most small models are bad at function calling)

## Notes

This document is my working draft. I'll update it as I build.
Alex said "你自己決定，我只看成品". So this is for me, not for review.
