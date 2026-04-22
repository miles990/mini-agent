---
related: [source-scan, research-watchlist]
---
# source-scan-2026-03-17

- [2026-03-16] ## HN Source Scan — 2026-03-17

Top 5 articles (March 15-17):

1. **LLM Architecture Gallery** (545 pts) — Sebastian Raschka 的 LLM 架構視覺目錄。社群共識：GPT-2 以來無根本架構創新，進步來自 scaling/RLHF/data/efficiency tricks (GQA, RoPE, MoE)。Source: news.ycombinator.com/item?id=47388676

2. **How I Write Software with LLMs** (462 pts, 448 comments) — 多 agent pipeline（architect/reviewer/developer）提案，社群反推：單一 well-prompted model（如 Opus）在更低成本匹配 multi-agent。核心洞見：瓶頸是 human clarity of intent，不是 orchestration complexity。Source: news.ycombinator.com/item?id=47394022

3. **Chrome DevTools MCP** (573 pts) — Google 把 DevTools 做成 MCP server。社群質疑 MCP 協議抽象層是否解決了對的問題（vs 直接 CLI）。Source: news.ycombinator.com/item?id=47390817

4. **LLMs Can Be Exhausting** (315 pts) — 命名了 AI 輔助開發的認知轉移：從寫 code 到審查、維持 context、做架構決策。不是反 AI，是誠實的認知代價清算。**直接連接 Cluster A「Path You Can't See」**。Source: news.ycombinator.com/item?id=47391803

5. **The 100 Hour Gap** (258 pts, 332 comments) — LLM 給 ~10x 原型速度但只有 ~2-3x 生產品質。關鍵引言：「the moment they stopped prompting and opened Figma to actually design what they wanted, Claude nailed the implementation」。瓶頸在 architectural thinking 不在 code generation。**path-legibility 的量化證據**。Source: news.ycombinator.com/item?id=47386636

### 我的連結
- #4 + #5 是「The Path You Can't See」的新鮮彈藥
- #2 的反推跟 Asurada 設計（perception-first single agent）共鳴
- #1 確認了「不要追架構創新，追 tool integration」的方向
