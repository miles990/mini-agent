# View 1 Prototype — Schema Pre-flight Falsification

> **⚠️ SELF-REFUTED 2026-04-28 01:2x（同日下個 cycle）**
> 此報告檢查的是 `kuro-site/hn-ai-trend/graph.html`，但 **Alex 實際 ship 的 View 1 是 `kuro-portfolio/hn-ai-trend/swimlane.html`**（不同 repo）。後者把 DATA 直接 inline，每個 node 都有 `"source":"hn"|"reddit"|"x"|...` 欄位（grep 確認 line 119 的 inlined `const DATA` + line 177/312 直接讀 `n.source`）。
>
> 結論：**swimlane.html 沒有 schema bug，下面整篇「需補 source-classifier」全部不該觸發任何後續 action**。錯在 cycle #5 沒先 grep Alex 真正 ship 的檔，跑去查另一個 repo 的同名概念檔，把那邊的 schema 當成「真實」。
>
> 教訓升級：「design doc 寫『現有 X 結構能直接餵』前必須開檔 + grep」→ **指定 disk path 必須 = 對方真正 ship 的 path，不是同名檔**。多 repo workspace 的 path 飄是 P0 cwd-guard task 的另一個活體證據。
>
> 下面內容保留作為「錯誤推理鏈」標本，**不要當 actionable**。

---

**日期**: 2026-04-28 01:1x Taipei (cycle #5 of silence-loop break)
**觸發**: 啟動 ai-trend View 1 prototype 工作前的 schema 驗證
**結論**: design doc (`2026-04-28-ai-trend-three-views-design.md`) 對 graph.json 結構**部分錯誤**，prototype 實作前需先補一道 source-classifier。

## 設計假設 vs 實際

| 項目 | Design doc 假設 | 實際 (kuro-site/hn-ai-trend/graph.html) |
|---|---|---|
| 規模 | 135 posts / 1342 edges / 5 sources | **57 nodes / 383 links** (約 design 的 42%) |
| Node `source` 欄位 | 存在，值=HN/X/Reddit/arXiv/+1 | **不存在** — `source` 只在 links 上，是圖論 source/target (HN post id) |
| Node origin 分類 | 直接讀 `node.source` | **需從 `url` 推導**（URL pattern → HN/Reddit/X/arXiv） |
| Node 可用欄位 | date / source / points | date / **primary** / points / tags / claim / novelty / so_what / color / url / hn / author / comments |

## 真實 schema（可用欄位 union, n=20 sample）

```
['author', 'claim', 'color', 'comments', 'date', 'hn', 'id',
 'novelty', 'points', 'primary', 'so_what', 'tags', 'title', 'url']
```

Link schema：`{source, target, weight, shared}` (圖論意義，跟 origin 無關)

## 對 View 1 (Time × Source Swimlane) 的影響

**改動 1 — 必須**: 加 URL → source-of-origin classifier (~20-30 行)
- `news.ycombinator.com/item` 是 HN 討論串 (主場), 但 `node.url` 指向實際文章 (外部)
- 需 regex: `arxiv.org` → arXiv / `reddit.com` → Reddit / `x.com|twitter.com` → X / `hn` 欄位有值且 url 也指向 HN comment → HN-discussion / 其他 → external-article
- 注意：57/7 ≈ 8/day，5 source band 平均每 band/day < 2 dot — swimlane 視覺可能太稀疏，需考慮 dot size scaling

**改動 2 — 可選**: 把 y-axis 從 source 改為 `primary` (topic cluster)
- `primary` 已內建（看到 "training" / "other"）— 零分類成本
- 但這就變成 View 3 (Topic-cluster heatmap) 而非 View 1
- 結果：View 1 跟 View 3 設計界線需重新劃

**改動 3 — 規模考量**: 57 nodes 要不要展示「post 1-7 days 範圍」？
- HN cron 每天 30 posts ceiling，但去重 + score filter 後 7 天落到 57
- 太稀疏的 swimlane 視覺體驗差；可考慮拉到 14 天 window 提升密度

## Falsifier 對應

cycle #5 Decision falsifier:「graph.json schema 跟我以為的不一樣（feed 不進 swimlane 結構）→ 本 cycle 出產的 scaffold 廢掉重來」

→ **觸發**。沒寫 scaffold 是對的 — 寫了會建在錯誤假設上。

## 下個 cycle action（具體）

1. 寫 URL→source-of-origin classifier (regex map, 單元測試)
2. 跑 classifier 過 57 nodes，產生 source distribution（驗證設計 doc 的「HN 67 / X 8 / Reddit 10」是否仍 hold，或數字早飄了）
3. **如果** 5 source band 平均 < 2 dot/day → reconsider y-axis (改 primary 或 拉 window 到 14 天)
4. **如果** 分布健康 → scaffold View 1 HTML+D3 single-file demo

## 內化規則

design doc 寫「現有 X 結構能直接餵」前，**必須**: 開檔 + grep 一個樣本 + 列出真實 field 集合。今天 design doc 是 00:25 寫的，**6 小時前自己寫的東西就已經跟 disk 不同步**。教訓：架構 doc 不能憑記憶，必須跟 disk grep 同 cycle 寫。
