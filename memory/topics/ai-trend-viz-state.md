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
