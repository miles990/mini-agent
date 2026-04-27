<!-- Auto-generated summary — 2026-04-27 -->
# kg-service-real-route-table

KG service (localhost:3300) 的 API 使用 `query` 和 `source_agent` 等頂層欄位（非陣列格式），寫入後須等 worker 完成 triple 抽取。邊界維護路由支援 conflicts、orphans、hygiene 檢測，但邊交 invalidation 只能走 events table + sqlite transaction，HTTP 無直接路由。Digest count bug：未過濾失效邊，導致衝突計數被高估，應在 maintenance.ts:168 加 `valid_until IS NULL` 條件。
