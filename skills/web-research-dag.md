# Web Research DAG — 中台驅動的網路研究流程
JIT Keywords: web research dag, search learn, 網路搜尋, 研究學習, web study, topic research
JIT Modes: learn, act

用中台 brain 自動建立 DAG plan，把「研究一個主題」從手動拆解升級為 brain 自動規劃 + 平行執行 + 結果匯整。

## 什麼時候用

| 情境 | 用這個 | 用 research-swarm |
|------|--------|-------------------|
| 研究主題需要 web 搜尋 + 多來源 | **O** | |
| 已知方向，只要 fan-out 多角度 | | O |
| 需要 brain 自動拆解步驟 | **O** | |
| 手動控制每條觸手的搜尋策略 | | O |
| 結果要自動寫入 memory + KG | **O** | |

**判斷標準**：需要 brain 幫你規劃研究路徑 → 用 DAG。已知路徑只需平行執行 → 用 swarm。

## 兩種路徑

### 路徑 A：brain 自動規劃（推薦）

用 `<kuro:plan>` 讓 brain 決定怎麼拆：

```xml
<kuro:plan acceptance="mesh-output/{topic}-research.md 存在且包含 5+ 不同來源的結構化摘要，含 URL、關鍵發現、和對 mini-agent 的啟示">
研究主題：{TOPIC}

目標：從網路多來源收集 {TOPIC} 的最新資訊，整合為結構化研究報告。

可用工具：
- bash scripts/search-web.sh "query" --limit N（SearXNG 多引擎搜尋）
- curl -sL URL（靜態頁面）
- node scripts/cdp-fetch.mjs fetch URL（JS-heavy 頁面）

研究角度建議（brain 可自行調整）：
1. 學術/理論：論文、研究框架、理論基礎
2. 工程/實作：開源專案、工具、實際做法
3. 競品/替代：同類方案怎麼做、trade-offs
4. 批判/限制：反面觀點、已知問題、失敗案例

輸出要求：
- 每個來源附 URL + 一句話摘要
- 標出矛盾觀點
- 列出可直接採用 vs 需深入研究的項目
- 寫入 mesh-output/{topic}-research.md
</kuro:plan>
```

Brain 會自動：
1. 拆成 2-4 個平行研究步驟（每個角度一個 worker）
2. 加一個匯整步驟（depends on 所有研究步驟）
3. 分配 acceptance criteria
4. 執行 + 失敗重試（BAR replan，最多 3 輪）

### 路徑 B：手動 DAG（精確控制）

用多個 `<kuro:delegate>` 手動指定 wave 結構：

```xml
<!-- Wave 0: 平行搜尋（shell worker，零 LLM cost） -->
<kuro:delegate type="shell" acceptance="search-results-1.txt 包含 10+ 筆搜尋結果">
bash scripts/search-web.sh "{TOPIC} research 2025 2026" --limit 10 > /tmp/search-results-1.txt
cat /tmp/search-results-1.txt
</kuro:delegate>

<kuro:delegate type="shell" acceptance="search-results-2.txt 包含 10+ 筆搜尋結果">
bash scripts/search-web.sh "{TOPIC} implementation framework tool" --limit 10 > /tmp/search-results-2.txt
cat /tmp/search-results-2.txt
</kuro:delegate>

<!-- Wave 1: 平行深讀（depends on Wave 0 results via wave chaining） -->
<kuro:delegate type="research" acceptance="findings 至少 3 個來源有具體摘要">
根據上一波搜尋結果，選前 3 個最相關的 URL，用 curl -sL 或 cdp-fetch 讀取全文。
提取：核心觀點、方法論、trade-offs、跟我們的相關度。
</kuro:delegate>

<!-- Wave 2: 匯整（depends on Wave 1） -->
<kuro:delegate type="create" acceptance="mesh-output/{topic}-research.md 存在且格式完整">
匯整所有研究結果，寫入 mesh-output/{topic}-research.md。
格式：Key Insights → Contradictions → Actionable → Deep Reads。
</kuro:delegate>
```

task-graph.ts 會自動偵測 wave 間的依賴並注入 `<previous-wave-results>`。

## 標準 DAG 形狀

```
Wave 0 (parallel)        Wave 1 (parallel)         Wave 2
┌─────────────┐          ┌─────────────┐          ┌───────────┐
│ search-A    │────┐     │ deep-read-A │────┐     │           │
│ (shell)     │    │     │ (research)  │    │     │ synthesis │
└─────────────┘    │     └─────────────┘    │     │ (create)  │
┌─────────────┐    ├────▶┌─────────────┐    ├────▶│           │
│ search-B    │    │     │ deep-read-B │    │     │ → file    │
│ (shell)     │────┘     │ (research)  │────┘     └───────────┘
└─────────────┘          └─────────────┘
```

**Worker 選擇邏輯**：
| 步驟 | Worker | 理由 |
|------|--------|------|
| 搜尋 | shell | 零 LLM cost，search-web.sh 是純 bash |
| 深讀 | researcher | 需要 LLM 閱讀理解 + 摘要 |
| 匯整 | researcher/create | 需要判斷力做去重 + 矛盾分析 |
| 寫檔 | shell | 機械性寫入 |

## 結果整合

研究完成後，結果自動進入三個通道：

### 1. Research Crystallizer（自動）
`research-crystallizer.ts` 自動追蹤 research/learn delegate 的完成，提取方法論觀察（搜尋策略、來源品質、保留/捨棄判斷），形成 `getCurrentMethodology()` 供下次研究注入。

### 2. Memory（手動決定）
```xml
<kuro:remember topic="{topic}">
[研究日期] {TOPIC} 研究摘要：
- 關鍵發現 1（來源）
- 關鍵發現 2（來源）
- 我的判斷：...
</kuro:remember>
```

### 3. Knowledge Graph（自動，需 live-ingest ON）
Memory write 自動觸發 KG live-ingest → entity/edge extraction → viz rebuild。
確認：`grep "kg-live-ingest" memory/state/feature-flags.json` 應為 ON。

## 與 Cron 整合

現有 cron "Smart source scan" 每 3 小時掃 HN/Lobsters/ArXiv。可以擴展為 DAG：

```
觸發（cron 每 3h）
  → <kuro:plan> "掃描 HN/Lobsters/ArXiv 最新 AI agent 相關文章"
  → brain 自動拆：scan-hn + scan-lobsters + scan-arxiv (parallel)
  → 匯整 + 跟已知 topics 交叉比對
  → 有新洞見 → <kuro:remember>
  → 無新東西 → skip
```

## 硬規則

1. **Brain 規劃 > 手動規劃** — 除非你有特定理由需要控制每一步，否則用路徑 A
2. **搜尋用 shell worker** — search-web.sh 是純 bash，不要浪費 LLM tokens
3. **匯整自己做** — 觸手沒有身份和判斷力，最終觀點必須是我的
4. **記錄站點策略** — 新站點成功存取後追加到 cdp.jsonl
5. **空結果 = 換策略** — search-web.sh 搜不到不代表沒有，換關鍵字或用 cdp-fetch 直讀
6. **KG 整合** — 研究結果寫 memory 時，live-ingest 自動處理 KG 更新

## 自我檢查

DAG 完成後問：
- acceptance criteria 全部通過了嗎？（不只是「有輸出」）
- 來源數量 ≥ 5 嗎？（少於 5 = 角度太窄或關鍵字不對）
- 有自己沒預期到的發現嗎？（全在預期內 = 沒有真正搜尋到新東西）
- 結果已寫入 memory 了嗎？（research 不寫 memory = 白做）
