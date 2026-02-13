# Repository Guidelines

## Core Positioning
mini-agent is a **perception-driven** personal AI agent framework.
- Perception-first, not goal-first.
- File = truth (Markdown/JSONL), no database.
- Transparency > isolation for personal-agent trust.

## Architecture Snapshot
- Runtime: `src/` (CLI/API/agent loop/memory/perception/dispatch).
- Memory: `memory/` (`MEMORY.md`, `HEARTBEAT.md`, `SOUL.md`, `topics/*.md`, `proposals/`, `handoffs/`).
- Plugins: `plugins/*.sh` (environment sensing).
- Build artifacts: `dist/` (generated).

Key modules:
- `src/agent.ts`, `src/loop.ts`, `src/memory.ts`, `src/dispatcher.ts`, `src/api.ts`, `src/observability.ts`, `src/perception-stream.ts`

## Build, Test, and Development Commands
- `pnpm build`: Compile `src/` to `dist/`.
- `pnpm typecheck`: Run strict TypeScript checks without emit.
- `pnpm test`: Run Vitest once.
- `pnpm test:watch`: Run Vitest in watch mode.
- `pnpm start`: Run compiled CLI from `dist/cli.js`.
- `pnpm setup`: Install deps, build, and local link.

Before PR or deploy:
- `pnpm typecheck && pnpm test`

## Coding Style & Naming Conventions
- Language: TypeScript (ES modules, NodeNext).
- Indentation: 2 spaces; semicolons enabled; single quotes.
- Naming: file `kebab-case`, vars/functions `camelCase`, types/classes `PascalCase`.
- Keep modules focused; colocate related helpers in same domain file.

## Agent Operating Model

### Action-from-Learning Levels
- **L1 Self-Improve**: may directly edit `skills/*.md`, `plugins/*.sh`, memory files.
- **L2 Feature Proposal**: changes touching `src/*.ts` require proposal in `memory/proposals/` and Alex approval.
- **L3 Architecture**: large cross-cutting changes require proposal + explicit effort/impact.

### Memory Model
- Hot/Warm/Cold + Topic memory.
- `[REMEMBER #topic]` writes to `memory/topics/{topic}.md`.
- `HEARTBEAT.md` = strategy/task board, `NEXT.md` = execution queue.

### Event-Driven Runtime
- Event bus: `trigger:*`, `action:*`, `log:*`.
- Observability subscriber routes events to logs/notify.
- Perception streams run by category interval with distinct-change behavior.

## Observability & Status First
When evaluating runtime/system behavior, **verify via live endpoints first** (do not rely only on docs):
- `GET /health`
- `GET /status`
- `GET /loop/status`
- `GET /logs`
- `GET /context`
- `GET /api/dashboard/behaviors`

Principle: **Verification over assumption**.

## Dashboard & Telemetry
- Main dashboard: `/dashboard` (`dashboard.html`).
- SSE stream: `GET /api/events`.
- Learning digest: `/api/dashboard/learning`.
- Journal digest: `/api/dashboard/journal`.
- Behavior timeline: `/api/dashboard/behaviors`.

## Testing Guidelines
- Framework: Vitest (`tests/**/*.test.ts`).
- Test files must be `*.test.ts` under `tests/`.
- Use behavior-oriented describe blocks.

## Commit & Pull Request Guidelines
- Conventional prefixes: `feat:`, `fix:`, `tidy:`, `learn:`, `revert:`, `improve:`.
- Imperative subject lines, scoped when useful.
- PR should include:
  - problem/solution summary
  - context/issue link
  - verification evidence (commands + key output)
- Include logs/screenshots for ops/UI changes (`dashboard.html`, deploy/scripts, plugin output).

## Deploy & Operations
CI/CD path:
- `commit -> push main -> GitHub Actions -> scripts/deploy.sh -> service restart -> health check`

Manual fallback:
- `./scripts/deploy.sh`

## Security & Config
- Use `.env` for secrets; never commit credentials/tokens.
- Review plugin shell safety/timeouts before enabling in `agent-compose.yaml`.
- If `MINI_AGENT_API_KEY` is enabled, provide `x-api-key`/Bearer for API calls.

## Collaboration Protocol (Alex + Coding Agent + Kuro)
- Alex: decisions/approval.
- Coding agent: implementation, verification, deployment.
- Kuro: perception, autonomous execution, reporting.

For cross-agent delegation, use `memory/handoffs/*.md` with status lifecycle:
- `pending -> approved -> in_progress -> completed|blocked`
