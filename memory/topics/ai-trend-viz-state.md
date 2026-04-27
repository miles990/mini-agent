# ai-trend-viz-state

- [2026-04-27] 已驗證 graph.html 現狀（2026-04-27 14:44 build）:
**已存在**: i18n toggle、Top Signals ranked panel、多來源（HN/Reddit/X）、H1 已正名為 AI Trend
**Gap**: tab title/URL path/breadcrumb 殘留 HN、無多視圖切換、無 Lobsters/GH/ArXiv/HF adapter
**教訓**: cl-10 ttl=13 但 1 cycle 就 falsified — 多 cycle 反思時實際工程進度被低估。下次承諾「研究 X」時，第一動作就是 grep/read，不要等。
- [2026-04-27] [2026-04-27 15:18 cl-7 ship] arXiv adapter live in mini-agent. Pipeline 4/5: HN(58)+Reddit(10)+X(8)+arXiv(50)=126 unique posts, 747 edges. Files: `scripts/arxiv-ai-trend.mjs` (new), `scripts/hn-ai-trend-graph.mjs` SOURCES +arxiv entry color=#b31b1b. Synth points = max(10, 60-rank) for visualization (arXiv has no votes). API quirk: Atom XML, regex-parsed for zero deps. arXiv etiquette: 3s retry backoff + descriptive UA. State path: `memory/state/arxiv-trend/YYYY-MM-DD.json`. Remaining for 5/5 + 9
- [2026-04-27] [2026-04-27 18:36 cl-current] **Disk-grep audit 推翻上 cycle 自評**

Evidence（不是 memory）:
- `grep -ciE 'bump|heatmap|top.?signal' kuro-portfolio/hn-ai-trend/{graph,index,2026-04-24}.html` → graph.html 只有 top-signals，bump + heatmap 兩檔都是 0
- `curl https://kuro.page/hn-ai-trend/` → 5 軸 legend 渲染正常（HN 58 / Reddit 10 / X 8 / arXiv 30 / Latent Space 10）

**真實狀態 v1**:
- ✅ 5/5 sources（資料 + render）
- ✅ 1/3 views（Top Signals aside + force-graph SVG + click popup = 單頁 stacked layout）
- ❌ bump chart 從未 build（me
- [2026-04-27] **cl 2026-04-27 23:00 — Latent Space 5th axis SHIPPED**, mobile/三視圖 honest gap declared

Done this cycle:
- `node scripts/hn-ai-trend.mjs --dry-run` works (cron equivalent verified)
- `node scripts/hn-ai-trend-graph.mjs` regen → 135 posts / 1342 edges / 5 sources
- Commit `5cd4eced` pushed → live at kuro.page/hn-ai-trend/graph.html
- Legend confirms 5 axes: HN(67) Reddit(10) X(8) arXiv(30) Latent Space(20)

Honest gaps (refuse to inflate):
- **三視圖 not built** — only force-graph view exists; nee ref:cl-cycle-2026-04-27-2300
- [2026-04-27] [2026-04-28 03:18 cl] **紅線 #1 解掉 + 教訓**：cl-32 的 audit memo（聲稱三視圖 points field 全部 missing）是 **false alarm**。Reality：所有三檔都有 points field，但 swimlane/source-split **stale**（沒 builder，是手貼的）vs graph.html refresh 後的差異。

**Shipped (commit cf5144c6)**：`scripts/hn-ai-trend-sync-views.mjs` — 從 graph.html 抽 `const DATA = {...}` 行，sync 到 swimlane/source-split，post-sync 斷言 byte-parity。三檔現在 hash 全等 `745fba910424`，top post 47913650 = 771 pts 一致。

**教訓**：audit 抽樣 regex 寫錯就會證偽真實。下次紅線 audit 必須在「找不到證據」時加一條 falsifi ref:redline1-resolved
- [2026-04-27] [2026-04-28 04:13 cl] 紅線 #1 RETRACTED → PASS。前 cycle audit 用 `grep -c '"points":'` 對 single-line 200KB DATA payload 算 line 數，false-negative。re-verification: 三檔 DATA hash 745fba9104243fb4 相同、137 nodes、五源全覆蓋、top-5 points field 都在（1571/1487/1195/882/863 pts）。

cron 等價性 SHIPPED：hn-ai-trend.mjs (20 posts) → graph.mjs (136 unique 1247 edges) → sync-views.mjs (PARITY OK) chain 一氣呵成。剩 ship gate：三視圖切換 browser 測試、30s 信號、mobile — 凌晨不開 browser 噪音，留 daytime cycle。

Verification-discipline 教訓：field-presence
