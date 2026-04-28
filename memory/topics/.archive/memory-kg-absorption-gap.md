# memory-kg-absorption-gap

- [2026-04-26] [2026-04-27 05:21 cl-32] 量化 gap 落地：memory/topics 199 entries (>=2026-03-28) vs KG kuro namespace 'pattern' query 80 hits。Gap ~60% un-ingested 上界。下一步先做 KG API schema discovery（`/api/digest` totalNodes 不存在、`/api/query` type 欄回 `?`，我的假設都錯），再寫 ingest script。**Lesson**: 即使 query schema 假設錯，數字本身仍揭露 gap — 不要因 parse failure 棄掉資料點。
