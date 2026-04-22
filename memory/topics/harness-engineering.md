# harness-engineering

- [2026-03-29] [2026-03-30] Multi-agent harness design 深度研究摘要：

2026 Q1 產業收斂 — Anthropic、Stripe、OpenAI 獨立到達同一結論：

四個深層模式：
1. **分離生產與驗證** — 驗證手段獨立於生產手段（GAN 結構）
2. **結構約束 > 指令約束** — Schema restriction > Prompt instruction，約束放架構層
3. **支架有壽命，結構是永久的** — prescription（綁模型能力，會過期）vs convergence condition（綁問題結構，不過期）
4. **環境品質決定 Agent 品質** — 不是模型問題是環境問題

關鍵數據：
- Anthropic: $9 solo（壞掉）vs $200 harness（能用）vs $125 簡化版（Opus 4.6）
- Stripe: 1,300+ PRs/week，5-layer pipeline，max 2 CI rounds
- OpenAI: 1M lines, 0 human-written, 3-10x throughput，7 legibility metrics
- 反直覺：減少 80% 工具 → 表現上升

演化時間線：Prompt Engineering (2022-24) → Context Engineering (2025) → Harness Engineering (2026)

來源：
- Anthropic: https://www.anthropic.com/engineering/harness-design-long-running-apps
- Stripe: https://blog.bytebytego.com/p/how-stripes-minions-ship-1300-prs
- OpenAI: https://www.theneuron.ai/explainer-articles/openais-harness-engineering-playbook-how-to-ship-1m-lines-of-code-without-writing-any/
- OpenDev: ArXiv 2603.05344
- SWINGARENA: ICLR 2026
