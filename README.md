# Mini-Agent

Minimal Personal AI Agent with two core concepts:

1. **Memory** - File-based persistence (no database)
2. **Proactivity** - Cron-based heartbeat

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    mini-agent                       │
│                   (~500 lines)                      │
├─────────────────────────────────────────────────────┤
│  Channels (入口)                                    │
│  ├ CLI (src/cli.ts)                                │
│  └ HTTP API (src/api.ts)                           │
├─────────────────────────────────────────────────────┤
│  Core Loop (src/agent.ts)                          │
│  └ receive → context → claude → respond            │
├─────────────────────────────────────────────────────┤
│  Memory (src/memory.ts)                            │
│  ├ MEMORY.md (long-term)                           │
│  ├ daily/YYYY-MM-DD.md (daily notes)               │
│  └ grep search (no embedding)                      │
├─────────────────────────────────────────────────────┤
│  Proactive (src/proactive.ts)                      │
│  ├ HEARTBEAT.md (task list)                        │
│  └ node-cron scheduler                             │
└─────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# Install
pnpm install

# Run CLI
pnpm cli

# Run API server
pnpm dev
```

## CLI Commands

```
/help           - Show help
/search <query> - Search memory
/heartbeat      - Show HEARTBEAT.md
/trigger        - Trigger heartbeat check
/remember <text>- Add to memory
/proactive on   - Start proactive mode
/proactive off  - Stop proactive mode
/quit           - Exit
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /chat | Send a message |
| GET | /memory | Read long-term memory |
| GET | /memory/search?q= | Search memory |
| POST | /memory | Add to memory |
| GET | /heartbeat | Read HEARTBEAT.md |
| POST | /heartbeat/trigger | Trigger heartbeat |
| POST | /proactive/start | Start proactive mode |
| POST | /proactive/stop | Stop proactive mode |

## Philosophy

This is the **minimal viable** personal AI agent:

- **No database** - Just Markdown files
- **No embedding** - grep search is enough
- **No complex state** - Files are the source of truth
- **Two concepts only** - Memory + Proactivity

Everything else is optional complexity.

## Requirements

- Node.js 20+
- Claude CLI (`claude` command available)
