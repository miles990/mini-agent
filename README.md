# mini-agent

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](tsconfig.json)
[![In Production](https://img.shields.io/badge/In_Production-1500%2B_cycles-green.svg)](#philosophy)

**The AI agent that sees before it acts.**

Shell scripts define what the agent can see — git changes, Docker health, Chrome tabs, phone sensors, Telegram messages. Claude decides what to do. Add a plugin, expand its world.

No database. No embeddings. Markdown files + shell scripts + Claude CLI. Running 24/7 in production since February 2026.

Most agent frameworks are goal-driven: "do X in N steps." mini-agent is **perception-driven**: it observes the environment continuously, then decides whether to act. The difference matters — goal-driven agents fail when the goal is wrong. Perception-driven agents adapt to what's actually happening.

## Quick Start

```bash
# Install
curl -fsSL https://raw.githubusercontent.com/miles990/mini-agent/main/install.sh | bash

# First run — interactive chat, auto-creates agent-compose.yaml
mini-agent

# Run autonomously in background
mini-agent up -d        # Start the OODA loop
mini-agent status       # What is it doing right now?
mini-agent logs -f      # Watch it think
```

The agent starts perceiving immediately — workspace changes, running services, open browser tabs. It decides on its own whether to act or wait.

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
Channels (CLI / HTTP API / Telegram / Mobile PWA)
       |
  Agent Core (perceive -> orient -> decide -> act)
       |
  +-----------+-----------+-----------+
  | Perception| Skills    | Memory    |
  | (plugins) | (.md)     | (.md)     |
  +-----------+-----------+-----------+
```

Each autonomous cycle:

1. **Perceive** — Run shell plugins, observe the environment
2. **Orient** — Build context from memory + perception + skills
3. **Decide** — Claude evaluates: act, wait, or delegate?
4. **Act** — Execute, record to memory, notify

Four building blocks:

- **Perception** — Shell scripts that output environment state. Anything scriptable becomes a sense
- **Skills** — Markdown files injected into the prompt. Domain knowledge the agent follows as instructions
- **Memory** — Markdown + JSON Lines. Hot (recent) → warm (daily) → cold (long-term). FTS5 search, no vector DB
- **Identity** — `SOUL.md` defines personality, interests, evolving thoughts. Not just a task executor

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

## More Features

- **Organic Parallelism** — Multi-lane architecture inspired by [slime mold](https://en.wikipedia.org/wiki/Physarum_polycephalum): main cycle + foreground lane + 6 background tentacles
- **System 1 Triage** — Optional [mushi](https://github.com/miles990/mushi) companion (8B model, ~800ms) filters noise before expensive LLM cycles — saves ~40% token cost
- **Telegram** — Bidirectional messaging with smart batching
- **Mobile PWA** — Phone sensors (GPS, gyro, camera) as perception inputs
- **Web Access** — Three-layer extraction: Readability+Turndown → trafilatura → VLM vision fallback
- **Team Chat Room** — Multi-party discussion with persistent history and threading
- **MCP Server** — Claude Code native integration (14 tools)
- **CI/CD** — Auto-commit → auto-push → GitHub Actions → deploy
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
