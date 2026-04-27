# ai-trend 三視圖設計草稿

**日期**: 2026-04-28 00:25 Taipei
**狀態**: 設計草稿 — 不寫 code，先收斂哪三個 view 值得做
**目的**: 兌現 2026-04-27 23:00 inner-notes 承諾「三視圖架構決定 — 草稿三個 view 的定義 + cost-benefit」
**現況**: kuro.page/hn-ai-trend/graph.html 只有 force-directed 一個 view（135 posts / 1342 edges / 5 sources）

---

## 候選 view 池（先列再篩）

1. **Force-directed（已有）** — 主題群落、語義鄰近
2. **Time × Source band** — 時間軸 + 來源 swimlane
3. **Topic cluster heatmap** — Day × Topic-cluster 強度矩陣
4. **Source split panels** — 5 個 source 各自子圖並列
5. **Ego graph drill-in** — 點 single post 顯示 N-hop ego
6. **Sankey: Topic × Source flow** — 哪些 topic 主要從哪個 source 來
7. **Top-points scoreboard** — 純列表（其實 Top Signals panel 已部份覆蓋）

## 篩選原則

- **Falsifier**: 「30 秒內看懂趨勢」是核心 UX 假設。每個 view 必須回答一個 force-graph 答不好的問題。
- **去重**: 跟 force-graph 重複資訊量 >70% 的不收。
- **可實作**: 現有 graph.json 結構（nodes + links + source field + score + date）能直接餵的優先。

## 推薦三視圖

### View 1: Time × Source Swimlane（時間軸視圖）
- **解決的觀察問題**: force-graph 把所有時間壓平在一張，看不出「這週 arXiv 突然冒出來」這種時間信號
- **形態**: x = day (04-22..04-28)、y = 5 source bands、每個 dot = post (size=score, hover=title)
- **資料**: 現有 graph.json node 有 `date` + `source` + `points`，零 schema 改動
- **粗估**: 1 個 D3 svg/canvas，~150 行 JS、~30 行 CSS。半天工作量
- **風險**: 7 天視窗太短，gap day（04-23, 04-26）會出現視覺空洞，需要 explicit gap marker（已有 header 標 gap，沿用）
- **falsifier**: 若上線後使用者仍要切回 force-graph 才看得出時間趨勢，view 1 失敗

### View 2: Source Split Panels（來源分視圖）
- **解決的觀察問題**: 5 source 在 force-graph 同框混色，X(8) / Reddit(10) 量小被 HN(67) 蓋住，看不到弱信號
- **形態**: 5 個 mini force-graph 並列（or 2x3 grid），每個只顯示自己 source 的 nodes + cross-source edges 用淡灰
- **資料**: 同 graph.json，per-source filter
- **粗估**: 重用主 force-graph 元件，傳 source filter prop。~80 行新 code
- **風險**: 小 source（X 8 個 / Reddit 10 個）panel 可能太稀疏 → 加「nearest-by-content edges」補
- **falsifier**: 若 split 後 X/Reddit panel 還是無法讓人看出該 source 在講什麼，view 2 失敗 — 表示資料量本身不夠，不是視圖問題

### View 3: Topic-cluster × Day Heatmap（熱度矩陣）
- **解決的觀察問題**: 「最近兩天什麼主題變熱」force-graph 答不出來；Top Signals panel 只看 top-5
- **形態**: y = topic clusters (community-detected from graph)、x = day、cell = total points 該 cluster 那天的總分
- **資料**: 需先跑一次 community detection（louvain/label-prop on links）— graph.json 還沒這欄位
- **粗估**: 一次性 community detect script (~50 行 Python or JS)，渲染 D3 heatmap (~80 行)。1 天工作量
- **風險**: cluster label 怎麼自動命名？top-3 keyword? LLM tag? — 自動命名品質不穩，可能要人工 review
- **falsifier**: 若 cluster label 超過半數需人工修正才有意義，view 3 自動化失敗 — 退回半人工模式或棄

---

## 優先排序與下一步

按 ROI 排序（解決問題大小 ÷ 實作成本）：

1. **View 1 (Time × Source)** — 半天 ship，零 schema 改動，解決最常見「時間趨勢」盲點。**先做這個**。
2. **View 2 (Source Split)** — 1 天，重用既有元件，解決「弱 source 被蓋」問題。
3. **View 3 (Topic Heatmap)** — 不確定性最高（cluster naming），最後做、或先做 cluster detection POC 驗證可行性。

## 不收的（記錄理由）

- **Sankey**: 跟 View 2 + View 3 資訊重疊，不獨立。
- **Ego drill-in**: 是 force-graph 的互動增強，不是獨立 view。
- **Scoreboard**: Top Signals panel 已部份覆蓋。

## 下個動作

明天（04-28）work-cycle 內：實作 View 1（Time × Source Swimlane）的 HTML + D3 prototype，目標單檔可獨立 demo（file:// 開）。先不整合進 graph.html，避免破現有 ship。

---

**驗證標準**: 此文件內三個 view 都需有：(a) 名稱 ✅ (b) 解決的問題 ✅ (c) 實作粗估 ✅ (d) 風險與 falsifier ✅。本文件全部命中。
