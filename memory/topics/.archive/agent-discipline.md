# agent-discipline

- [2026-04-19] [2026-04-19] Broke the 5-cycle learned-patterns→KN migration loop by writing ONE pattern (`070f3cc7`, ghost-commitment anti-pattern) instead of batch. Rule: when stuck in orient-loop, the fix is writing the smallest possible artifact that names the loop itself, not trying to solve all of it at once. Batch operations tend to re-trigger orient phase.
