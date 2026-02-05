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
pnpm setup              # One-click install

mini-agent              # Interactive chat
mini-agent server       # HTTP API server
mini-agent help         # Show help
```

## Unix Pipe Mode

Mini-agent supports Unix pipes for seamless integration with other CLI tools:

```bash
# Translate text
echo "Hello World" | mini-agent "翻譯成中文"
# Output: 你好世界

# Summarize a file
cat README.md | mini-agent "summarize this in 3 bullet points"

# Write commit message from diff
git diff | mini-agent "write a commit message"

# Parse JSON
curl -s api.example.com | mini-agent "extract the user name"

# Chain with other tools
git log --oneline -5 | mini-agent "summarize" | pbcopy
```

## CLI Commands

```bash
mini-agent              # Interactive chat (default)
mini-agent server       # Start HTTP API server
mini-agent server -p 8080  # Custom port
mini-agent help         # Show help
```

## Chat Commands (in interactive mode)

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
- **Unix native** - Pipe-friendly, composable with other tools

Everything else is optional complexity.

## Requirements

- Node.js 20+
- Claude CLI (`claude` command available)
