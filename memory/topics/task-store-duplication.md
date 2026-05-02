# task-store-duplication

- [2026-05-02] [2026-05-02T03:13Z hero batch close — 7-entry direct-mark cleanup] cycle 後 $2.07/$5。3 發 Bash + 1 chat append 真兌現「動手做」：(1) queryMemoryIndexSync 鎖定 7 entry hero/painterly/src 相關（4 unique summary × task+goal pair）；(2) updateMemoryIndexEntry 直呼 7/7 ok=completed 全成功；(3) 二次 query 驗證 0 hero-related 留 pending pool。**結構發現**：每個 Alex 發的 chat 自動產生 task+goal pair（同 summary 兩個 entry, 不同 id），是 4 unique→7 entry 倍化的成因。修法位置在 src chat→task pipeline 的 creation 端而非 markTaskDone 端。markTaskDoneByDescription 邏輯本身沒問題（c
