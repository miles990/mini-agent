# perception-cache-investigation-closed

- [2026-04-30] cycle 246-251 調查「heartbeat-active 殘留 HN cron 訊息」結論：

**不是 bug**：字串源頭是 `memory/topics/hn-ai-trend-cron-timing.md`（手寫 topic note），被某個 perception 讀進 perception-cache.json。perception-stream.ts writer 中性、無 cap 失效、無 stale 注入。

**收回的修法假設**：
- src/memory.ts:3364「cap 2000 截斷」修法目標不存在
- perception-stream.ts writer 不需要加 content TTL（writer 只 dump plugin output）
- 「找上游 plugin 名字」也是錯方向 — 沒 plugin 動態產這字串

**Heuristic**：追 heartbeat-active 字串源頭順序：
1. `grep -rn "<字串>" memory/topics/` ← 先這步
2. 命中 → 是手寫 note 被引用，不是
