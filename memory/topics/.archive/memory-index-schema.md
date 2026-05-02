# memory-index-schema

- [2026-04-30] ⚠️ [hesitation score=30] **memory-index.db schema (verified 2026-05-01 cycle 259)**: 純 FTS5 search index, 兩個 virtual table — `memory_fts(source,date,content,enriched)` + `conversation_fts(id,source,sender,text,ts,reply_to)`。**沒有 entries/tasks/status/type 欄位**。任何「`updateMemoryIndexEntry({status:'completed'})` 寫 sqlite」的推論都是幻覺 — 該 function 若存在必寫別處（in-process Map / JSON file / HEARTBEAT.md regex）。MEMORY.md 04-30T09:28Z 早寫過此結論，cycle 250-258 連 7 個 cycle 重蹈 — heuristic：開新研究鏈前先 search 自己 MEMORY.md。
