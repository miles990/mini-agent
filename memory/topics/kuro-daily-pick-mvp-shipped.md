# kuro-daily-pick-mvp-shipped

- [2026-05-01] 2026-05-01T19:22 ship `scripts/kuro-daily-pick.mjs` (mini-agent commit 939ffa29, 251 行) + 今日 8 picks 產出。

設計決策（自己拍的，沒問 Alex）：
- 來源：HN top 30 + lobste.rs hottest 25（cdp.jsonl 已驗 curl 可讀，不需 CDP）
- 評分：per-source normalize 後 70% points + 30% comment ratio — 因為 HN 基線 ~150-300 lobsters ~30-80，不 normalize 則 lobsters 永遠輸
- dedupe：exact URL + 5-token title overlap（避免 04-11 紀錄的 dedup gap 重演）
- 不限主題：Alex 19:19 明確說「不一定要和 AI 相關」
- 8 picks 上限：比 hn-ai-trend 6 picks 多一點，留給跨領域內容空間

Pending：(1) 加 cron 09:30 entr
