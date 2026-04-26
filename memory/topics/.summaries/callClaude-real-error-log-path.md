<!-- Auto-generated summary — 2026-04-26 -->
# callClaude-real-error-log-path

The real callClaude error logs are at `~/.mini-agent/instances/03bbc29a/logs/error/YYYY-MM-DD.jsonl` (not the non-existent agent-middleware/server.log). The 1500s timeout originates from `middleware-cycle-client.ts`'s DEFAULT_TIMEOUT_MS, not agent.ts's 90s default, via the chain: loop.ts → callClaude → execProvider → middleware. The three observed timeout events are sporadic API-level hangs (confirmed by silent_exit_void diagnostic signal), not a persistent outage or auth issue.
