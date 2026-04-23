<!-- Auto-generated summary — 2026-04-23 -->
# kg-conflict-audit-2026-04-17

This audit reveals a 30% data consistency drift between two KG conflict files (conflicts.jsonl and resolution-audit.jsonl) caused by two independent code paths that populate different fields using different classification rubrics, with no back-sync mechanism. The root issue is architectural: the resolver script writes its decisions only to audit.jsonl but never updates conflicts.jsonl, which was populated separately with a different schema. The fix requires either consolidating to a single source of truth (audit.jsonl) or extending the resolver script to synchronize its outputs back to conflicts.jsonl.
