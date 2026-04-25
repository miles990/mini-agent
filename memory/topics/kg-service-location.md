# kg-service-location

- [2026-04-25] [2026-04-25 15:25] `which kn` returns not-found despite KG service running on :3300 and accepting POST /api/v1/knowledge. Implication: service was likely started via project-local script, npx, or aliased command — not a global binary. Next-cycle probe: `lsof -iTCP:3300 -sTCP:LISTEN` → get PID → `lsof -p <PID> | grep -E "cwd|txt"` to find source tree, then grep for edge endpoint route definitions. Also check `~/.config/launchd` and project package.json scripts in case service is plugin-managed.
