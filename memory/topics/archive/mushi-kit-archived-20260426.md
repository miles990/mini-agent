---
related: [mushi, crystallization-research, myelin-strategy, small-language-models]
---
# mushi-kit

- : 所有核心介面加上  泛型參數
- :  支援自訂 action 類型 + 新增  作為主 API（ 保留為向後相容別名）
-  +  + : 內部函數泛型化
- 新增 3 個測試：自訂 action、process()/triage() 一致性、自訂 action 結晶
- 56/56 測試通過 + TypeCheck clean
- 向後完全相容：現有的  不用改任何代碼
- 新用法： +

核心發現：MCP 社群正在經歷 stdio vs HTTP 的分裂辯論。Charles Chen 指出 stdio 模式是多餘開銷，但 HTTP-based 集中式 MCP 對企業治理有價值。

mushi-kit 定位機會：
1. mushi 不是協議層（MCP 的領域），是學習層——兩者互補
2. MCP 的 token bloat 批評直接驗證 mushi 的 value prop（減少重複呼叫）
3. 「不是另一個協議層，是減少呼叫次數的學習層」— 可用於 Show HN 差異化定位
4. 企業方向（Phase 2+）：集中式規則結晶 + MCP over HTTP = 組織級 agent 成本優化棧
- Claude CLI 尊重  環境變數（即使用 subscription auth 而非 API key）
- myelin proxy 能完整攔截  請求
- 發現並修復 content-encoding bug（fetch auto-decompresses but header forwarded → ZlibError）— commit 655ce48
- 設置： 加 ， 管理腳本
- Log 路徑：（payload.jsonl, proxy.jsonl, cache.json）
- **dogfooding 價值已證明**：自己用立刻發現 bug

1. **Semantic Caching for NL2Code** (2601.11687) — 生產級 dual-threshold 快取：>0.995 直接回傳(23%)，0.50-0.995 用結構模式引導生成(44%)，<0.50 全新生成(33%)。token 降 40-60%，準確率 94.3%。核心洞見：guide zone（結構相似引導）比 exact match 更有價值。pattern extraction 把 1000-2000 token 壓到 200-300 token。

2. **Agentic Plan Caching** (2506.14852) — 從 agent 執行中提取 plan template 重用，50% 成本降低，27% 延遲降低。

**myelin 定位差異**：兩篇都是 domain-specific（analytics / agent planning）。myelin 是通用型 middleware，這個 gap 沒有人填。dual-threshold 概念可以直接借鑑到 myelin 的結晶化 vs passthrough 決策。
