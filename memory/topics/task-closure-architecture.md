# task-closure-architecture

- [2026-04-30] markTaskDoneByDescription 真實實作於 mini-agent/src/memory-index.ts:1515-1563 (NOT memory.ts, NOT loop.ts, NOT cycle-tasks.ts). Path: queryMemoryIndexSync(type=task|goal, status=pending|in_progress) → 5-rule fuzzy match → updateMemoryIndexEntry({status:completed}). Single caller: loop.ts:2875. Does NOT write HEARTBEAT.md, does NOT round-trip readHeartbeat/updateHeartbeat. memory-index store is separate from memory_fts sqlite (FTS schema only). True bug locus per MEMORY.md 04-27: queryMemoryIndexSync
