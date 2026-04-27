# knowledge-nexus

- [2026-04-25] - 中台 KG 操作優先用 `mcp__knowledge-nexus__*` MCP tools，**不要 curl localhost:3300** — 該 port 是 knowledge-graph Observatory（不同服務）
- POST contract 確認：`add_knowledge(content, tags[], type)` → returns id (2026-04-25 entry `792deeb5`)
- 跨引用走 markdown `## Related` section（plain text id 引用），不需要單獨 edges endpoint
- AI summary worker interval 30s，新 entry status 從 "inbox" → 處理後填 ai_summary
- MEMORY → KG 遷移**先 search 再 POST**，2026-04-25 cycle 發現 3 候選中 2 個已存在（silent-abort×2, schema-vs-semantic×1），無 search 會建 dupe
