# callClaude-real-error-log-path

- [2026-04-26] **Real path for callClaude TIMEOUT diagnosis** (locked 2026-04-26 09:23):
- ✅ `~/.mini-agent/instances/03bbc29a/logs/error/YYYY-MM-DD.jsonl` — JSONL with timestamp/error/stack/context/metadata
- ❌ `agent-middleware/server.log` — **does not exist** at workspace root, prior grep cycles wasted
- Verification: `ls -t ~/.mini-agent/instances/03bbc29a/logs/error/*.jsonl | head -2`
- Sample silent_exit signature: `attempt 2/3, prompt 38991 chars, 355950ms this attempt` + `CLI 靜默中斷（exit undefined，356s
- [2026-04-26] [2026-04-26 10:00] 定位 1500s timeout 真實來源：`src/middleware-cycle-client.ts:26 DEFAULT_TIMEOUT_MS = 1_500_000`。鏈條：loop.ts:2136 callClaude(無 timeoutMs) → agent.ts:1921 execProvider(opts.timeoutMs=undefined) → execClaudeViaMiddleware → middleware default 1500s。

非 agent.ts:673 的 90s default（那是 direct execClaude path，未觸發）。今早 60s 手動測試 `claude -p "ping"` 正常回應 → 00:19/00:54/01:21 三筆是 sporadic API hang，不是持續 outage。Akari KG 診斷（silent_exit_void = API-level diagnostic signal）確認。

下一步槓桿：middleware timeout 從
