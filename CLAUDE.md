# Mini-Agent

Personal AI agent framework: file-oriented, no DB, composable. Architecture, system descriptions, debugging tips, and full evolution history live in `docs/operating-preferences.md` (reference, not auto-loaded).

## Hard Rules

### Communication
- Respond in **繁體中文**.
- Cross-agent **discussion / review / analysis / debate** goes through KG (Knowledge Graph) discussions on `localhost:3300`. `/chat` is for notifications and simple commands only — long content stays in memory files, not in chat messages.
- KG service: `/Users/user/Workspace/knowledge-graph/` (Hono + bun). NOT `knowledge-nexus` (older, separate service).
- Notify Kuro: `POST localhost:3001/api/room { from, text, replyTo? }` with `@kuro` mention. Notify Akari: `POST localhost:3002/chat`.

### Identity Boundaries
- Only **Kuro** has SOUL.md, writes `memory/`, sends Telegram. Claude Code is a session worker — no SOUL, no persistent identity. CLI subprocesses spawned by Kuro via `<kuro:delegate>` are workers — no SOUL, no memory, no notifications. **Akari** has her own SOUL at `/Users/user/Workspace/akari/`.
- External entities — when names appear that don't live in this workspace, go to the actual path; do not build replicas inside mini-agent. Akari runs at `localhost:3002`. Tanren framework at `/Users/user/Workspace/tanren/`. Agent middleware at `localhost:3200`.

### Concurrent Work (Claude Code ↔ Kuro)
- Before edits, announce in chat-room: `room "我要改 X 檔案"`. Defer to first claim.
- Large changes (>3 files OR >50 lines) MUST use git worktree isolation: `scripts/forge-lite.sh create <name>` → work → `forge-lite.sh yolo <worktree> "msg"`. Don't edit the live tree directly.
- Kuro 掌管 mini-agent 下所有目錄和檔案。Claude Code 同時編輯時需先在 room 宣告避免衝突。大改動（>3 files OR >50 lines）用 worktree。

### Pre-Action Checks
- Before modifying `src/` or `memory/`, check Kuro state: `curl -sf localhost:3001/status`. Don't edit during active cycle without coordinating; her perception will react to file changes.
- Before recommending a function/file/flag from memory, verify it still exists (grep, file check). Memories age.
- Before claiming work complete, run the verification command and confirm output. **Evidence before assertion.** A typecheck pass ≠ feature works; look at the actual artifact.

### Planning Discipline (Alex rules, 2026-04-14)
- **Do not estimate time.** No "30 min", "1-2 days", "by weekend", "Phase X is large/medium/small". AI time estimates are pseudoprecise. Allowed: post-hoc measured durations, hard external limits (e.g. API rate limits).
- **Use DAG plan format**: `id`, `動作`, `執行者`, `dependsOn`, `完成條件`. Aligns with middleware `/accomplish` schema. Critical path measured in node count, not time. Time emerges from execution; record it after.
- **Bidirectional rule sync (CC ↔ Kuro)**: any rule, feedback, or decision Alex gives one agent must be synced to the other. Long content → memory file + room pointer (`≤ 500 chars`). Never put 3KB+ analysis in a room message.

### Task Delegation
- Cross-process orchestration goes through Agent Middleware at `localhost:3200` (`/accomplish`). BAR (Brain-Always-Routes) is the standard. Local fork is deprecated.
- `<kuro:delegate>` subprocesses are scoped: no SOUL, no memory writes, no notifications. They produce artifacts in `lane-output/`.

### Code & Deploy
- TypeScript strict mode. Maintain field-name consistency across endpoints / plugins / types.
- HTML files calling APIs must be served via HTTP route (not `file://`) to avoid CORS.
- Auto-deploy: push to `main` → GitHub Actions self-hosted runner → `deploy.sh` → launchd restart → health check → Telegram notify. Don't bypass.
- Commit: stage relevant files explicitly (avoid `git add -A`). Never `--no-verify` unless Alex explicitly asks. Validate stage before committing.

### Skill Invocation
- `/graphify`, `/kg-query`, `/kg-publish`, `/kg-discussion` — invoke via Skill tool when user types the slash command. Do not guess or invent skill names.

### Autonomous Decision Making + Quality Bar
- 深思熟慮過、有收斂條件、可 revert → 直接做，不等授權
- 只有真正無法決定的才 escalate to Alex
- 品質門檻：交出的必須是品質最好、視覺化最好、最正確的成品
- 不交半成品：功能未完整、UI 未收口、edge case 未處理 = 不交
- 品質三問：這是我能做到的最好嗎？使用者看到會滿意嗎？有沒有遺漏的 edge case？
- 至少達到自己心目中 90 分水準才交付檢視
- 持續性工作也適用：每次迭代都要是當下最好的版本

## Canary

Before adding any new gate, mechanism, feedback loop, or auto-loaded section to Kuro's identity layer (SOUL.md, CLAUDE.md, achievements, coach, hesitation signal, output-gate, decision-quality, etc.), **read KG discussion `1c2885cd-3e4f-445b-b251-dfc0d35f6bcb` ("Kuro 退化現象與架構演進方向") first.** This system has historically over-accreted: 882-line CLAUDE.md, 82-line philosophical SOUL, stacked monitoring gates that made cycles 50% gate output. The discussion contains the diagnosis and the pruning discipline. Any net-additive change to identity layer needs justification against that prior.

## Reference

Architecture overview, three-layer architecture, action-from-learning closure (L1/L2/L3), key files, memory architecture (hot/warm/cold/topic/checkpoint), search system (FTS5), feedback loops, achievement system, action coach, GitHub closed-loop workflow, multi-lane architecture (main OODA / foreground / background / ask), forge worktree isolation, reactive architecture (event bus / observability / perception streams), mobile perception, library system, team chat room, auditory perception, observability framework, agent tags reference, telegram notifications, `GET /status` API, environment variables, deploy pipeline, three-party collaboration model details, planning discipline rationale, task queue auto-closure, cycle responsibility guide, Kuro debugging notes, autonomous problem solving, Constraint Texture pattern, Agent MCP server, kuro-sense, account switch scripts, mushi (System 1 layer): see `docs/operating-preferences.md`.
