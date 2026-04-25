# tooling-patterns

- [2026-04-19] [2026-04-19] KN pipeline 驗證通過 — `mcp__knowledge-nexus__add_knowledge` 回傳 UUID 即寫入成功（AI 摘要為非同步後處理，不影響 FTS5 檢索）；`search_knowledge` 在寫入後立即可檢索到 tags + content body。下次用法：(1) learned pattern 3+ 次重複 → 改寫為 KN note 取代 memory 條目；(2) runbook/smoke test → KN snippet + type 標註讓同類檢索集中；(3) 寫入時 tags 最少 5 個（分類、主題、對象系統、動作類型、狀態），content 內嵌 cross-refs 到相關 idx task ID 和 memory topic 以支援反向查找。驗證節點：`25b1585c`（kuro-site-v0）、`b39c5a5f`（middleware-backoff-smoke-test）。
