# kg-service-location

- [2026-04-25] [2026-04-25 15:25] `which kn` returns not-found despite KG service running on :3300 and accepting POST /api/v1/knowledge. Implication: service was likely started via project-local script, npx, or aliased command — not a global binary. Next-cycle probe: `lsof -iTCP:3300 -sTCP:LISTEN` → get PID → `lsof -p <PID> | grep -E "cwd|txt"` to find source tree, then grep for edge endpoint route definitions. Also check `~/.config/launchd` and project package.json scripts in case service is plugin-managed.
- [2026-04-25] [2026-04-25 15:30] KG service ground truth (verified by grep on `/Users/user/Workspace/knowledge-nexus/internal/server/server.go:52-97` + full test file route inventory + MCP tool surface):

**HTTP routes** (chi router, port 3300):
- `/api/v1/knowledge` CRUD + `/search` + `/{id}/ai` + `/{id}/attachments` (nested)
- `/api/v1/projects` CRUD
- `/api/v1/sessions` CRUD + `/current` + `/{id}/end`
- `/api/v1/insights/{knowledge,sessions,suggestions,gaps}` (GET)
- `/api/v1/attachments/{id}` CRUD
- `/ap
