# Mini-Agent

Minimal Personal AI Agent with three core concepts:

1. **Memory** - File-based persistence (no database)
2. **Proactivity** - Cron-based heartbeat
3. **Multi-Instance** - Isolated instances with role configuration

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    mini-agent                       │
├─────────────────────────────────────────────────────┤
│  Channels (入口)                                    │
│  ├ CLI (src/cli.ts)                                │
│  └ HTTP API (src/api.ts)                           │
├─────────────────────────────────────────────────────┤
│  Instance Manager (src/instance.ts)                │
│  ├ ~/.mini-agent/instances/{id}/                   │
│  ├ config.yaml, instance.yaml                      │
│  └ master/worker/standalone roles                  │
├─────────────────────────────────────────────────────┤
│  Core Loop (src/agent.ts)                          │
│  └ receive → context → claude → respond            │
├─────────────────────────────────────────────────────┤
│  Memory (src/memory.ts) - Instance Isolated        │
│  ├ MEMORY.md (long-term)                           │
│  ├ HEARTBEAT.md (tasks)                            │
│  ├ daily/YYYY-MM-DD.md (daily notes)               │
│  └ grep search (no embedding)                      │
├─────────────────────────────────────────────────────┤
│  Proactive (src/proactive.ts)                      │
│  └ node-cron scheduler                             │
└─────────────────────────────────────────────────────┘
```

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/miles990/mini-agent/main/install.sh | bash
```

## Quick Start

```bash
mini-agent              # Interactive chat (default instance)
mini-agent up           # Create & attach to new instance
mini-agent up -d        # Create instance in background
mini-agent help         # Show help
```

## Instance Management (Docker-style)

```bash
# Create & start (attach by default)
mini-agent up --name "Research"
mini-agent up -d --name "Worker"     # Detached mode

# List instances
mini-agent list

# Stop instances
mini-agent down abc12345
mini-agent down --all

# Attach to running instance
mini-agent attach abc12345

# Start/stop/restart
mini-agent start abc12345
mini-agent restart abc12345

# Kill (delete) instances
mini-agent kill abc12345
mini-agent kill --all

# Status
mini-agent status
mini-agent status abc12345
```

### Use Specific Instance

```bash
# Chat with specific instance
mini-agent --instance abc12345 "hello"

# File mode with instance
mini-agent --instance abc12345 code.ts "review this"
```

## Data Structure

```
~/.mini-agent/
├── config.yaml                 # Global configuration
├── instances/
│   ├── default/                # Default instance
│   │   ├── instance.yaml       # Instance config
│   │   ├── MEMORY.md           # Long-term memory
│   │   ├── HEARTBEAT.md        # Tasks
│   │   ├── SKILLS.md           # Available skills
│   │   ├── daily/              # Daily notes
│   │   └── logs/               # Logs
│   └── {uuid}/                 # Custom instances
└── shared/
    └── GLOBAL_MEMORY.md        # Shared memory (optional)
```

## Unix Pipe Mode

```bash
# Translate text
echo "Hello World" | mini-agent "翻譯成中文"

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
# Basic usage
mini-agent              # Interactive chat (default instance)
mini-agent "prompt"     # Single prompt mode
mini-agent file.txt "prompt"  # File mode

# Instance management (Docker-style)
mini-agent up [options]       # Create & attach
mini-agent up -d [options]    # Create in background
mini-agent down <id|--all>    # Stop instance(s)
mini-agent list               # List all instances
mini-agent attach <id>        # Attach to running instance
mini-agent start <id>         # Start stopped instance
mini-agent restart <id>       # Restart instance
mini-agent status [id]        # Show status
mini-agent kill <id|--all>    # Delete instance(s)
mini-agent logs [type]        # Show logs

# Up options
-d, --detach            # Run in background
--name <name>           # Instance name
--port <port>           # Server port
--persona <desc>        # Persona description

# Global options
-i, --instance <id>     # Use specific instance
--data-dir <path>       # Custom data directory
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
/config         - Show current config
/config set <key> <value> - Update config
/instance       - Show current instance
/instances      - List all instances
/quit           - Exit
```

## API Endpoints

### Instance Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/instance | Current instance info |
| PUT | /api/instance | Update current instance |
| GET | /api/instances | List all instances |
| POST | /api/instances | Create new instance |
| GET | /api/instances/:id | Get specific instance |
| DELETE | /api/instances/:id | Delete instance |
| POST | /api/instances/:id/start | Start instance |
| POST | /api/instances/:id/stop | Stop instance |

### Chat & Memory

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /chat | Send a message |
| GET | /memory | Read long-term memory |
| GET | /memory/search?q= | Search memory |
| POST | /memory | Add to memory |
| GET | /context | Get full context |

### Tasks & Proactive

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /tasks | List tasks |
| POST | /tasks | Add a task |
| GET | /heartbeat | Read HEARTBEAT.md |
| PUT | /heartbeat | Update HEARTBEAT.md |
| POST | /heartbeat/trigger | Trigger heartbeat |
| POST | /proactive/start | Start proactive mode |
| POST | /proactive/stop | Stop proactive mode |

### Config

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /config | Get configuration |
| PUT | /config | Update configuration |
| POST | /config/reset | Reset to defaults |

## Configuration

### Global Config (~/.mini-agent/config.yaml)

```yaml
defaults:
  port: 3001
  proactiveSchedule: "*/30 * * * *"
  claudeTimeout: 120000
  maxSearchResults: 5

instances:
  - id: default
    role: standalone
```

### Instance Config (instance.yaml)

```yaml
id: "abc12345"
name: "Research Assistant"
role: standalone  # master | worker | standalone
port: 3002

persona:
  description: "A technical research assistant"
  systemPrompt: |
    You are a helpful research assistant...

proactive:
  enabled: true
  schedule: "0 9,12,18 * * *"

memory:
  maxSize: "50MB"
  syncToGlobal: false
```

## Philosophy

This is the **minimal viable** personal AI agent:

- **No database** - Just Markdown files
- **No embedding** - grep search is enough
- **No complex state** - Files are the source of truth
- **Instance isolated** - Each instance has its own memory
- **Unix native** - Pipe-friendly, composable with other tools

Everything else is optional complexity.

## As Claude Code Skill

Copy the `SKILL.md` file to your project's `.claude/skills/mini-agent/` directory.

## Requirements

- Node.js 20+
- Claude CLI (`claude` command available)

## Roadmap

### Planned Features

- [ ] **agent-compose.yaml** — Docker Compose 風格的多 agent 宣告式配置
  ```yaml
  # agent-compose.yaml
  agents:
    researcher:
      name: "Research Agent"
      port: 3001
      persona: "專精於網路搜尋"
    coder:
      name: "Coding Agent"
      port: 3002
      depends_on: [researcher]
  ```
  ```bash
  mini-agent up           # 啟動所有 agent
  mini-agent down         # 停止所有 agent
  ```

- [ ] **Inter-agent Communication** — Agent 之間的訊息傳遞
- [ ] **Shared Memory** — 跨 instance 共享記憶
- [ ] **Task Delegation** — Master 分配任務給 Worker

## Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/miles990/mini-agent/main/uninstall.sh | bash
```
