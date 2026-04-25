# kg-resolver-asymmetry

- [2026-04-16] KG resolver R2 vs R3 嚴格度不對稱（2026-04-17 verified）：
- R2（code-symbol vs artifact）：無 ext signal → 升級 R7-needs-review（嚴格）
- R3（code-symbol vs concept）：無 PascalCase signal → default 給 concept + confidence=medium（寬容）
影響：所有 23 個 conflicts 都能自動解決，0 個 R7。改成嚴格會讓 5 個 case 變人工 review。
教訓：上 cycle 看 chat-room log 推測「缺 R-default 路徑」是錯的 — default 邏輯在 R3 內部有 explicit 分支。**評論自己系統前先讀 code，不要從 log 行為 pattern-match。**
File: scripts/kg-resolve-entity-types.ts:152-161
