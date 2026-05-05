# arxiv-429-real-cause

- [2026-05-05] [2026-05-05T17:30Z cycle 377] 9:25 chat 提出「arxiv max=50 超友善上限 → 429」假說，本 cycle 兩發 curl `-sIL` 真驗 **REFUTED**：max=50 回 HTTP/2 200，緊接著 max=30 回 HTTP/2 429。順序反過來測也應同結果（待下次驗）— 真因是 **per-IP burst rate-limit / 請求間距太短**，不是 max parameter。`scripts/arxiv-ai-trend.mjs` log 顯示 `fetchText` 連 retry 3 次每次 backoff 3000ms*attempt（最長 9s）對 arxiv 友善上限太短，arxiv 政策建議 ≥3s 但 burst window 看似更長。**Patch A 真設計**：不動 max，改 `fetchText` retry 的 429 分支 sleep ≥30000ms（30s）後重試，且 retry 間 jitter 避免 cron + retry 形成週期性 hammer。**Falsi
