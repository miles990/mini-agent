# heartbeat-md-writer-map

- [2026-04-30] mini-agent/memory/HEARTBEAT.md 是 HN cron 字串源頭（cycle 252 定位、cycle 253 grep 確認）。

**Writers**：
- cycle-tasks.ts:327 TTL decay（改 P-level 前綴，不動 checkbox）
- cycle-tasks.ts:391 size cleanup（風險點，超限時 rewrite + notifyTelegram「垃圾污染」）
- memory.ts:1645 updateHeartbeat / :1782 addTask
- feedback-loops.ts:192 error pattern ≥3 → P1 escalation
- pulse.ts:1185（待查）

**Readers only**：search.ts:303、omlx-gate.ts:120（content-hash skip-gate — edit 後 hash 變會觸發 LLM call）、dispatcher.ts:1489、prompt-builder.ts:278

**安全 e
