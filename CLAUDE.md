# Mini-Agent

## Project Overview

Minimal Personal AI Agent framework with autonomous capabilities:
1. **Memory** - File-based persistence (MEMORY.md + HEARTBEAT.md + daily notes)
2. **AgentLoop** - OODA autonomous cycle (Observe → Orient → Decide → Act)
3. **Cron** - Scheduled proactive tasks via Docker Compose-style configuration
4. **Perception** - Full environment awareness (builtin modules + custom shell plugins)
5. **Skills** - Markdown knowledge modules injected into system prompt
6. **Smart Guidance** - Core behavior: always provide actionable, state-aware guidance
7. **Web Access** - Three-layer web fetching (curl → Chrome CDP → user login)
8. **Multi-Instance** - Docker-style instance management with compose

## Architecture Principles

| Principle | Description |
|-----------|-------------|
| No Database | Plain Markdown + JSON Lines. Human-readable, Git-versionable |
| No Embedding | grep-based search. Fast enough for personal use |
| File = Truth | Files are the single source of truth |
| Instance Isolation | Each instance has independent memory directory |
| Unix Native | Pipe-friendly, composable with CLI tools |
| Docker-Style | Familiar `up`, `down`, `attach`, `kill` workflow |
| Pluggable | Shell scripts as perception plugins, Markdown as skills |
| Smart Guidance | Core behavior principle in system prompt — agent reads perception data and automatically provides actionable guidance in all interactions. Not per-feature patches. |

## Three-Layer Architecture

```
Perception (See)  +  Skills (Know How)  +  Claude CLI (Execute)
─────────────────    ──────────────────    ─────────────────────
Builtin modules      Markdown files        --dangerously-skip-
+ Shell plugins      → system prompt       permissions
→ context injection
```

- **Perception** provides real-time environment data (what the agent sees)
- **Skills** provide domain knowledge (what the agent knows how to do)
- **Claude CLI** provides execution capability (what the agent can do)

## Workflow Preferences

- When asked to 'plan', 'design', or 'discuss', present the plan first in markdown, then ask before implementing
- For architecture decisions, use: 1) Present design, 2) List steps, 3) Ask to proceed
- Primary language: TypeScript (strict mode). Use TypeScript conventions and strict typing
- Confirm scope before implementing multi-file changes
- Always respond in 繁體中文

## Key Files

| Module | Path | Description |
|--------|------|-------------|
| CLI | `src/cli.ts` | Main entry, Docker-style commands, /loop commands |
| Agent | `src/agent.ts` | Core: receive → context → claude → respond |
| Memory | `src/memory.ts` | Hot/Warm/Cold three-tier + custom extensions |
| AgentLoop | `src/loop.ts` | OODA autonomous cycle with pause/resume |
| Perception | `src/perception.ts` | Shell plugin executor + Skill loader |
| Workspace | `src/workspace.ts` | Workspace perception (files, git, recent) |
| Instance | `src/instance.ts` | Multi-instance process management |
| Compose | `src/compose.ts` | Docker Compose-style orchestration |
| Cron | `src/cron.ts` | Scheduled task manager with hot reload |
| Watcher | `src/watcher.ts` | File watcher for compose hot reload |
| API | `src/api.ts` | REST API (Express) + loop control endpoints |
| Config | `src/config.ts` | Instance-aware configuration |
| Proactive | `src/proactive.ts` | Heartbeat system |
| Logging | `src/logging.ts` | JSON Lines structured logging |
| FileLock | `src/filelock.ts` | File-based locking for instance management |
| Types | `src/types.ts` | TypeScript type definitions |
| Exports | `src/index.ts` | Public API exports |
| CDP Client | `scripts/cdp-fetch.mjs` | Chrome CDP client (zero-dependency, Node.js native WebSocket) |
| Chrome Setup | `scripts/chrome-setup.sh` | Interactive Chrome CDP setup guide |

## Perception System

### Builtin Modules (7)

| Module | Context Tag | Data |
|--------|-------------|------|
| Environment | `<environment>` | Time, timezone, instance ID |
| Self | `<self>` | Name, role, port, persona, loop/cron status |
| Process | `<process>` | Uptime, PID, memory, other instances, log stats |
| System | `<system>` | CPU, memory, disk, platform |
| Logs | `<logs>` | Recent errors, events summary |
| Network | `<network>` | Port status, service reachability |
| Config | `<config>` | Compose agents, global defaults |
| Workspace | `<workspace>` | File tree, git status, recent files |

### Custom Plugins (Shell Scripts)

Any executable file can be a perception plugin. stdout → `<name>...</name>` XML tag → Claude context.

```yaml
# agent-compose.yaml
perception:
  custom:
    - name: docker
      script: ./plugins/docker-status.sh
      timeout: 5000  # optional, default 5000ms
```

Plugin location: `plugins/` directory. Included plugins: chrome-status, web-fetch, docker-status, port-check, disk-usage, git-status, homebrew-outdated.

### Skills (Markdown Knowledge Modules)

Pure Markdown files injected into system prompt under `## Your Skills`.

```yaml
skills:
  - ./skills/docker-ops.md
  - ./skills/debug-helper.md
```

Skill location: `skills/` directory. Included skills: web-research, docker-ops, debug-helper, project-manager, code-review, server-admin.

## Web Access (Three-Layer)

Three-layer web fetching strategy, falling through automatically:
1. **curl** — Public pages, APIs (fast, < 3s)
2. **Chrome CDP** — User's authenticated browser session (port 9222)
3. **Open page** — Visible tab for user login/verification

Key files:
- `scripts/cdp-fetch.mjs` — Zero-dependency CDP client (Node.js native WebSocket)
  - Commands: `status`, `fetch <url>`, `open <url>`, `extract <tabId>`, `close <tabId>`
- `scripts/chrome-setup.sh` — Interactive setup guide
- `plugins/chrome-status.sh` — CDP status + smart guidance (detects Chrome running/stopped)
- `plugins/web-fetch.sh` — Auto-fetch URLs from conversations
- `skills/web-research.md` — Three-layer workflow knowledge

All error scenarios are handled by the core [Smart Guidance](#architecture-principles) mechanism — agent reads perception data and automatically provides state-specific guidance. No per-plugin hardcoded guidance needed.

Error handling: `callClaude()` catches errors and returns friendly messages instead of 500. Classifies errors (ENOENT, timeout, maxbuffer, permission) into user-readable explanations.

Environment: `CDP_PORT=9222` (default), `CDP_TIMEOUT=15000`, `CDP_MAX_CONTENT=8000`

## Memory Architecture

```
Hot  (In-Memory)  → Last 20 conversations (conversationBuffer)
Warm (Daily File) → 100 entries/day (daily/YYYY-MM-DD.md)
Cold (Long-term)  → MEMORY.md + HEARTBEAT.md + SKILLS.md
```

Instance isolation:
```
~/.mini-agent/instances/{id}/
├── MEMORY.md       # Long-term knowledge
├── HEARTBEAT.md    # Task management
├── SKILLS.md       # Capabilities
├── daily/          # Daily conversation logs
└── logs/           # JSON Lines structured logs
    ├── server.log
    ├── claude/     # Claude operation logs
    ├── api/        # API request logs
    ├── cron/       # Cron + AgentLoop cycle logs
    └── error/      # Error logs
```

## Project Structure

```
./
├── agent-compose.yaml   # Compose configuration
├── plugins/             # Custom perception plugins (shell scripts)
│   ├── chrome-status.sh
│   ├── web-fetch.sh
│   ├── docker-status.sh
│   ├── port-check.sh
│   └── ...
├── skills/              # Markdown knowledge modules
│   ├── docker-ops.md
│   ├── debug-helper.md
│   └── ...
├── memory/              # Project-specific memory
├── logs/                # Project-specific logs
├── scripts/             # Utility scripts (cdp-fetch.mjs, chrome-setup.sh)
└── src/                 # TypeScript source
```

## Commands

```bash
# Development
pnpm build          # Build TypeScript
pnpm start          # Run CLI
pnpm typecheck      # Type check only
pnpm test           # Run tests (vitest)

# CLI Usage
mini-agent              # Interactive chat
mini-agent up           # Start from compose (attach)
mini-agent up -d        # Start detached
mini-agent up --init    # Generate template compose
mini-agent down         # Stop all
mini-agent list         # List instances
mini-agent attach <id>  # Attach to instance
mini-agent status       # Show status
mini-agent logs         # Log statistics
mini-agent logs -f      # Follow logs (live)
mini-agent help         # Show help

# Interactive commands
/loop status            # AgentLoop status
/loop pause             # Pause loop
/loop resume            # Resume loop
/loop trigger           # Manual trigger
/search <query>         # Search memory
/remember <text>        # Add to memory
```

## Environment Variables

```bash
PORT=3001                # API port (default: 3001)
MINI_AGENT_INSTANCE=id   # Current instance ID
MINI_AGENT_API_KEY=xxx   # API authentication key (optional)
CDP_PORT=9222            # Chrome CDP port (default: 9222)
CDP_TIMEOUT=15000        # CDP operation timeout in ms (default: 15000)
CDP_MAX_CONTENT=8000     # Max content extraction chars (default: 8000)
```

## Development Guidelines

- Keep it minimal. No unnecessary dependencies
- Files over database. grep over embedding
- Test core modules: memory, cron, compose, config
- Validate all external input (API requests, CLI args)
- Use structured logging (JSON Lines) over console.log
- Follow existing patterns when adding new features
- Perception plugins: any executable that writes to stdout
- Skills: pure Markdown, no code execution
