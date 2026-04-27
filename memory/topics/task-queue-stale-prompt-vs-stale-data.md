# task-queue-stale-prompt-vs-stale-data

- [2026-04-27] [2026-04-27 cl-2-2982] **Disambiguating stale prompt rendering vs stale data**

When `<task-queue>` claims a task is pending but you've already written a `status:"deleted"` tombstone:
1. **Don't re-tombstone**. The append-handler is idempotent (toEntryMap line 140: `map.delete(id)` on deleted), but re-emitting wastes cycles + grows the file.
2. **Disambiguate with one node script**: `invalidateIndexCache() + queryMemoryIndexSync({status:['pending','in_progress']})` — if it returns the task, dat
