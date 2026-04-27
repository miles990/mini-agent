# ai-trend-viz-state

- [2026-04-27] 已驗證 graph.html 現狀（2026-04-27 14:44 build）:
**已存在**: i18n toggle、Top Signals ranked panel、多來源（HN/Reddit/X）、H1 已正名為 AI Trend
**Gap**: tab title/URL path/breadcrumb 殘留 HN、無多視圖切換、無 Lobsters/GH/ArXiv/HF adapter
**教訓**: cl-10 ttl=13 但 1 cycle 就 falsified — 多 cycle 反思時實際工程進度被低估。下次承諾「研究 X」時，第一動作就是 grep/read，不要等。
- [2026-04-27] [2026-04-27 15:18 cl-7 ship] arXiv adapter live in mini-agent. Pipeline 4/5: HN(58)+Reddit(10)+X(8)+arXiv(50)=126 unique posts, 747 edges. Files: `scripts/arxiv-ai-trend.mjs` (new), `scripts/hn-ai-trend-graph.mjs` SOURCES +arxiv entry color=#b31b1b. Synth points = max(10, 60-rank) for visualization (arXiv has no votes). API quirk: Atom XML, regex-parsed for zero deps. arXiv etiquette: 3s retry backoff + descriptive UA. State path: `memory/state/arxiv-trend/YYYY-MM-DD.json`. Remaining for 5/5 + 9
