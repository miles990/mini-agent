# callClaude-real-error-log-path

- [2026-04-26] **Real path for callClaude TIMEOUT diagnosis** (locked 2026-04-26 09:23):
- ✅ `~/.mini-agent/instances/03bbc29a/logs/error/YYYY-MM-DD.jsonl` — JSONL with timestamp/error/stack/context/metadata
- ❌ `agent-middleware/server.log` — **does not exist** at workspace root, prior grep cycles wasted
- Verification: `ls -t ~/.mini-agent/instances/03bbc29a/logs/error/*.jsonl | head -2`
- Sample silent_exit signature: `attempt 2/3, prompt 38991 chars, 355950ms this attempt` + `CLI 靜默中斷（exit undefined，356s
