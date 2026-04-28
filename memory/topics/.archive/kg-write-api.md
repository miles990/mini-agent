# kg-write-api

- [2026-04-26] KG 服務 (localhost:3300) `/api/write` 真實 payload schema: `{source_agent: string, text: string}` — 不是 `{operations: [{type, id, kind, ...}]}`。寫入後得到 `buffer_id`，背景 worker async 抽取 triples (`auto_extraction:true`)。MEMORY.md 既存 route table 只記 path 沒記 body shape — 下次寫 body 前先 curl `/api/write` 空 body 看 error message 確認 required fields，不要憑記憶寫 schema。
- [2026-04-26] [2026-04-27 05:09 cl-14] Per-write extraction verification 紀律：`/api/write` 回應的 `buffer_id` 必須 capture 進 working-memory，否則下個 cycle 只能做 stats-level (buffer_pending=0 + nodes++) 模糊驗證，無法做 per-write attribution。今日 cl-13 的 commitment「驗 extraction 結果」就因為沒 capture buffer_id 退化為系統健康度檢查（仍 pass，但精度不夠）。Falsifier: 下次寫入後 working-memory 必須出現 `buffer_id=...`，否則 commitment 違反。
