# delegation-system

- [2026-04-17] **Delegate trace 正規落點（2026-04-18 T1 verification 修正）**：`~/.mini-agent/instances/<id>/lane-output/del-<taskId>.json`，per-task JSON 格式，24h TTL 後由 `cleanupTasks()` 清理。不是 route-log.jsonl（那是 OODA cycle builds），也不是 commitments.json（那是 cross-cycle ledger）。Read helpers: `memory.ts:3423-3538` + `nutrient.ts:45` + `delegation-summary.ts:105` + `pulse.ts:578` + `prompt-builder.ts:296`。Write 由 SDK worker 在 task complete 時執行。
