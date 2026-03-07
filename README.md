# mini-agent

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](tsconfig.json)

**The AI agent that sees before it acts.**

Most AI agent frameworks are goal-driven — "give me a goal, I'll execute steps." mini-agent is perception-driven — it sees the environment first, then decides what to do. AutoGPT/BabyAGI's biggest flaw was "hands without eyes." mini-agent flips it: perception before action.

No database. No embeddings. Just Markdown files, shell scripts, and Claude. ~29K lines of TypeScript, battle-tested over 1000+ autonomous cycles.

## Quick Start

```bash
# Install
curl -fsSL https://raw.githubusercontent.com/miles990/mini-agent/main/install.sh | bash

# Run
mini-agent              # Interactive chat (auto-creates config)
mini-agent up -d        # Start in background
mini-agent status       # Check what's happening
```

## What a Cycle Looks Like

The agent runs autonomously. Here's a typical cycle:

```
── Perceive ─────────────────────────────────
  <workspace> 2 files changed: src/auth.ts, src/api.ts </workspace>
  <docker> container "redis" unhealthy (OOM) </docker>

── Decide ───────────────────────────────────
  Redis OOM is blocking the API. Fix infrastructure first.

── Act ──────────────────────────────────────
  Restarted redis with --maxmemory 256mb. API responding.
  Notified via Telegram: "Redis was OOM, restarted with memory limit."
```

Each cycle: perceive → decide → act. No human prompt needed.

## What Makes It Different

| | Platform Agents | Goal-Driven (AutoGPT) | mini-agent |
|---|---|---|---|
| **Core idea** | Agents on a platform | Goal in, steps out | See first, then act |
| **Identity** | Platform-assigned | None | SOUL.md — personality, growth |
| **Memory** | Platform DB | Vector DB | Markdown files (human-readable) |
| **Perception** | Platform APIs | Minimal | Shell scripts — anything is a sense |
| **Security** | Sandbox | Varies | Transparency > Isolation |
| **Complexity** | Heavy | 181K lines (AutoGPT) | ~29K lines TypeScript |

## How It Works

```
Perception (See)  +  Skills (Know How)  +  Claude CLI (Execute)
```

**Perception** — Shell script plugins that tell the agent what's happening. Git changes, Docker status, Chrome tabs, phone GPS — anything you can write a script for becomes a sense.

**Skills** — Markdown files injected into the system prompt. They tell the agent *how* to do things: workflows, checklists, safety rules.

**Memory** — Markdown files + JSON Lines. Human-readable, Git-versionable. No vector DB needed — FTS5 full-text search handles personal-scale data.

**Identity** — `SOUL.md` defines who the agent *is*. Not just a task executor — personality, interests, evolving thoughts.

## Architecture

```
Channels (CLI / HTTP API / Telegram / Mobile PWA)
       |
  Agent Core (receive -> perceive -> think -> act)
       |
  +-----------+-----------+-----------+
  | Perception| Skills    | Memory    |
  | (plugins) | (.md)     | (.md)     |
  +-----------+-----------+-----------+
```

The agent runs an OODA loop (Observe-Orient-Decide-Act) autonomously. Each cycle:

1. **Observe** — Run perception plugins, check environment
2. **Orient** — Build context from memory + perception + skills
3. **Decide** — Claude evaluates: is action needed?
4. **Act** — Execute, record to memory, notify

## Perception Plugins

Any executable that writes to stdout becomes a sense:

```bash
#!/bin/bash
# plugins/my-sensor.sh — outputs get injected as <my-sensor>...</my-sensor>
echo "Status: $(systemctl is-active myservice)"
echo "Queue: $(wc -l < /tmp/queue.txt) items"
```

```yaml
# agent-compose.yaml
perception:
  custom:
    - name: my-sensor
      script: ./plugins/my-sensor.sh
```

Included: workspace changes, Docker, Chrome CDP, Telegram inbox, mobile GPS, GitHub issues/PRs, and more — [34 plugins](plugins/) out of the box.

## Skills (Markdown Modules)

```yaml
skills:
  - ./skills/docker-ops.md      # Container troubleshooting
  - ./skills/web-research.md    # Three-layer web access
  - ./skills/debug-helper.md    # Systematic debugging
```

Write domain knowledge in Markdown. The agent follows it as instructions. [25 skills](skills/) included.

## Configuration

```yaml
# agent-compose.yaml
version: '1'
agents:
  assistant:
    name: My Assistant
    port: 3001
    persona: A helpful personal AI assistant
    loop:
      enabled: true
      interval: "5m"
    cron:
      - schedule: "*/30 * * * *"
        task: Check HEARTBEAT.md for pending tasks
    perception:
      custom:
        - name: docker
          script: ./plugins/docker-status.sh
    skills:
      - ./skills/docker-ops.md
```

## Key Features

- **OODA Loop** — Autonomous cycle with adaptive intervals
- **Organic Parallelism** — Multi-lane architecture inspired by [Physarum](https://en.wikipedia.org/wiki/Physarum_polycephalum) slime mold: main cycle + foreground + 6 background tentacles exploring in parallel
- **System 1 Triage** — Optional [mushi](https://github.com/miles990/mushi) companion (Llama 3.1 8B, ~800ms) filters noise before expensive LLM cycles — saves ~40% token spend
- **Telegram** — Bidirectional messaging with smart batching
- **Mobile PWA** — Phone sensors (GPS, gyro, camera) as perception
- **Web Access** — Three-layer extraction: Readability+Turndown → trafilatura → VLM vision fallback
- **Team Chat Room** — Multi-party discussion with persistent history
- **MCP Server** — Claude Code native integration (14 tools)
- **CI/CD** — Auto-commit → auto-push → GitHub Actions → deploy
- **Dashboard** — Real-time SSE-powered status view
- **Agent Modes** — calm / reserved / autonomous

## API

```
GET  /status          # Unified status (all subsystems)
GET  /context         # Full perception context
POST /chat            # Send message
GET  /health          # Health check
GET  /api/events      # SSE real-time stream

POST /loop/trigger    # Manual OODA cycle
GET  /loop/status     # Loop state

GET  /memory          # Read memory
GET  /memory/search   # FTS5 search
```

## Requirements

- Node.js 20+
- [Claude CLI](https://docs.anthropic.com/en/docs/claude-code) (`npm install -g @anthropic-ai/claude-code`)
- Chrome (optional, for web access via CDP)

## Philosophy

> "There is no such thing as an empty environment."

A personal AI agent shares your context — your browser sessions, your conversations, your files. Isolating it means isolating yourself. mini-agent chooses **transparency over isolation**: every action has an audit trail (behavior logs + git history + File=Truth).

The agent's world is defined by its perception plugins — its [Umwelt](https://en.wikipedia.org/wiki/Umwelt). Add a plugin, expand what it can see. What it sees shapes what it does.

## Documentation

- [CLAUDE.md](CLAUDE.md) — Full architecture reference
- [memory/ARCHITECTURE.md](memory/ARCHITECTURE.md) — Detailed system design
- [CONTRIBUTING.md](CONTRIBUTING.md) — How to contribute
- [plugins/](plugins/) — All perception plugins
- [skills/](skills/) — All skill modules

[Full architecture reference →](CLAUDE.md)

## License

[MIT](LICENSE)
