# kg-write-api

- [2026-04-26] KG 服務 (localhost:3300) `/api/write` 真實 payload schema: `{source_agent: string, text: string}` — 不是 `{operations: [{type, id, kind, ...}]}`。寫入後得到 `buffer_id`，背景 worker async 抽取 triples (`auto_extraction:true`)。MEMORY.md 既存 route table 只記 path 沒記 body shape — 下次寫 body 前先 curl `/api/write` 空 body 看 error message 確認 required fields，不要憑記憶寫 schema。
