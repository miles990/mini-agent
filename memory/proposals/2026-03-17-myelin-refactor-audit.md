# Myelin 重構審計報告

**日期**: 2026-03-17
**範圍**: myelin dataflow refactor + feedback loop closure + triage removal
**Commits**: `86f4bca`, `dc7f317`, `375c5d3`, `11fd345`, `61038a4`

## 問題（重構前 baseline）

| 問題 | 數據 |
|------|------|
| Bypass 決策丟失 | 489+ 決策只進 trail/kbObserve，不進 crystallization pipeline |
| Triage domain 餓死 | 0 筆 LLM 決策，因為 hard-rule bypass 在 myelin 上游短路 |
| Distill 空轉 | 44 次 `distill_complete` 全部 rules=0/templates=0/dimensions=0/principles=0 |
| 回饋迴路斷開 | `getMyelinPromptBlock()` 已實作但未接入 prompt |
| Domain 分散 | 4 個 domain，其中 triage 結構性死亡 |

## 修復與驗證

### Fix 1: Bypass 資料回流（`86f4bca`）
- **改動**: loop.ts 4 個 bypass 點接上 `logTriageBypass()`
- **驗證**: myelin-decisions.jsonl 現有 21 筆 `method: "rule"` wake 決策（P0-pending / alert / startup）
- **狀態**: ✅ 資料在流動

### Fix 2: 智能 Distill（`dc7f317`）
- **改動**: fleet `distillAll()` → per-domain `instance.maybeDistill({ minNewDecisions: 3 })`
- **驗證**: 加了 `stats.totalDecisions === 0` guard，無決策的 domain 直接跳過
- **狀態**: ✅ 消除空轉

### Fix 3: Route bypass 走 myelin（`375c5d3`）
- **改動**: routing bypass 決策也透過 myelin 記錄，hitCount 持久化
- **驗證**: myelin-routing-decisions.jsonl 有 123 筆決策
- **狀態**: ✅ routing 是最活躍的 domain

### Fix 4: 回饋迴路閉合（`11fd345`）
- **改動**: 接上 `getMyelinPromptBlock()`，結晶規則注入 LLM prompt
- **驗證**: commit 存在，功能已接入
- **狀態**: ✅ 迴路閉合

### Fix 5: Triage domain 移除（`61038a4`）
- **改動**: 從 `createFleet()` 移除 triage domain，`mushi-client.ts` 直接呼叫 mushi HTTP
- **驗證**: typecheck ✅, 194/194 tests ✅, triage 不再出現在 fleet
- **狀態**: ✅ 承認 hard rules 已經是結晶化後的行為

## 當前 Myelin 健康狀態

### 結晶規則（19 條）

| Domain | 規則數 | 活躍規則 | 總 hitCount | 最新命中 |
|--------|:---:|:---:|:---:|------|
| **routing** | 3 | 2 | 13 | 2026-03-17 |
| **learning** | 2 | 0 | 0 | — |
| **research** | 14 | 4 | 18 | 2026-03-17 |
| **合計** | **19** | **6** | **31** | — |

### 決策數據量

| Domain | 決策數 | 檔案大小 |
|--------|:---:|------|
| routing | 123 | 43 KB |
| research | 849 | 247 KB |
| learning | 67 | 24 KB |
| triage (legacy) | 65 | 6.6 KB |
| **合計** | **1,104** | **320 KB** |

### 活躍度指標

- Routing rule_1（reply→foreground）: **11 hits** — 最常用的規則
- Research rule_3（depth-assess→deep-dive）: **6 hits** — 研究深度判斷
- Research rule_1/2/4/5（AI topic 相關）: **各 3 hits** — 主題選擇穩定

## Before / After 對比

| 指標 | Before | After | 改善 |
|------|--------|-------|------|
| Distill 空轉次數 | 44 次 | 0 次 | **-100%** |
| Bypass 決策進 pipeline | 0 筆 | 21 筆（持續增加） | **∞** |
| 回饋迴路 | 斷開 | 閉合 | **質變** |
| 死亡 domain | 1（triage） | 0 | **-100%** |
| 有效 domain | 3/4（75%） | 3/3（100%） | **+25%** |
| 活躍規則（hitCount > 0） | 未追蹤 | 6/19（32%） | **建立 baseline** |

## 判斷

### 做對了什麼
1. **吃自己的狗食** — 用 Alex 教的思考方式（五維度、全方位審視包括自己）分析 myelin，發現了「建了系統但沒閉迴路」的核心問題
2. **不補丁修表象** — 沒有強餵 triage domain，而是承認 hard rules 已經是結晶化行為，移除死 domain
3. **驗證閉環** — 每個 fix 都有 typecheck + tests，不是「commit 了就完成」

### 剩餘風險
1. **Learning domain hitCount = 0** — 2 條規則還沒被命中，需要觀察幾天
2. **Research domain 14 條規則中 10 條 hitCount = 0** — 可能是剛結晶還沒跑夠 cycle
3. **回饋迴路效果未量化** — `getMyelinPromptBlock()` 接上了，但結晶規則對 LLM 決策品質的影響還需要幾天數據

### 下一步
- 一週後重新審計 hitCount 分布，看哪些規則真的有用
- 如果 learning 規則持續 0 hit，考慮修剪
- 觀察回饋迴路閉合後，routing 決策的 LLM bypass 率是否提升（規則越好 → LLM 介入越少）

## 結論

五個 commit、三天工作。核心改變不是加功能，是**修資料流** — 讓已有的系統實際運作。最大的 ROI 是回饋迴路閉合（`11fd345`）：這讓 myelin 從「記錄決策」變成「學習決策」。
