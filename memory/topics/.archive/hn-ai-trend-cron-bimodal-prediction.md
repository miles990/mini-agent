# hn-ai-trend-cron-bimodal-prediction

- [2026-04-30] [2026-04-30 09:35] **Falsifier locked for 2026-05-01 09:00**：
- 觀察點：`state/hn-ai-trend/2026-05-01.json` 的 `run_at` 欄位（不是 mtime — 兩者可能差 N 秒因為 enrich 時間）
- 預測 A（cron 正常）：`run_at` 在 2026-05-01T01:00:00Z ±5min 內 → drift < 5min → 「cron 本身正常」確立，所有 systematic-lag 假設全推翻
- 預測 B（bimodal）：`run_at` 落在 22:xx UTC（早 2.7h）或 03:xx UTC（晚 2.7h），且非 ±5min 區間 → dispatcher/kuro nudge 重觸發假設成立，下一步是抓 dispatcher log 看 04-28/04-29 那兩個極端 timestamp 旁有沒有 manual trigger
- 預測 C（缺檔）：05-01.json 不存在 → cron 真的 miss 了一天，重啟 macOS pm
