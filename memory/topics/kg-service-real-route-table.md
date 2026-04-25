# kg-service-real-route-table

- [2026-04-25] KG service localhost:3300 schema 補完（2026-04-26 確認）：
- POST /api/query body: `{"query":"...","limit":N}` — param 是 `query` 不是 `q`
- POST /api/write body: `{"source_agent":"...","namespace":"...","text":"..."}` — top-level fields，不是 nodes array
- /api/write 走 auto-extraction pipeline（背景 worker 抽 triples），response 形如 `{"buffered":true,"buffer_id":"...","auto_extraction":true}`
- 寫入後 lesson/pattern 不會立刻可查 — 要等 worker 完成
