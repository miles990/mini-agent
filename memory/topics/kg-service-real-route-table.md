# kg-service-real-route-table

- [2026-04-25] KG service localhost:3300 schema 補完（2026-04-26 確認）：
- POST /api/query body: `{"query":"...","limit":N}` — param 是 `query` 不是 `q`
- POST /api/write body: `{"source_agent":"...","namespace":"...","text":"..."}` — top-level fields，不是 nodes array
- /api/write 走 auto-extraction pipeline（背景 worker 抽 triples），response 形如 `{"buffered":true,"buffer_id":"...","auto_extraction":true}`
- 寫入後 lesson/pattern 不會立刻可查 — 要等 worker 完成

- [2026-04-27 cycle hygiene] 真實服務位置：cwd=`/Users/user/Workspace/knowledge-graph/`（不是 knowledge-nexus）。entry: `bun run src/index.ts`，PID 81424，DB at `knowledge-graph/knowledge-graph.db` (WAL)。
- Hygiene-relevant routes（/api/* prefix）:
  - `GET /api/conflicts[?namespace=X]` → list active CONFLICTS_WITH edges (filter `valid_until IS NULL`)
  - `GET /api/maintenance/orphans?limit=N` → orphan nodes
  - `POST /api/maintenance/hygiene` → batch close empty discussions / detect orphans / staleness scoring
  - `POST /api/supersede` `{old_node_id,new_node_id,source_agent}` (nodes only)
  - `POST /api/invalidate` `{node_id,source_agent,valid_until?}` (nodes only — **no edge invalidate HTTP route**)
- **Edge invalidation** 只能走 events table：`INSERT INTO events (type='invalidate_edge', entity_type='edge', entity_id=<edge_id>, data, source_agent, timestamp)` + `UPDATE edges SET valid_until=ts WHERE id=...`，atomic transaction via sqlite3 CLI（service 用 WAL，並發寫入安全）。
- **Digest count bug**：`/api/digest` 的 unresolved conflicts count 來自 `SELECT COUNT(*) FROM edges WHERE relation='CONFLICTS_WITH'` — **沒有 valid_until IS NULL filter**，所以 digest 數字 = active + invalidated 總和，會 overstate。要看真實 backlog 用 `/api/conflicts` 長度。修法：maintenance.ts:168 加 `AND valid_until IS NULL`。下次有 KG repo 編輯機會順手修。
