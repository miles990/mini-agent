# agent-cycle-cost-thresholds

- [2026-05-01] **Agent cycle cost threshold heuristic v1 (2026-05-02T03:28Z, cycle 109)**

收斂三個獨立信號到一張表：(a) Uber 4 個月燒完年預算 = 3× underestimate，root cause 是 budget model 假設 LLM=chat tokens 沒料到 multi-turn tool-call 爆發 (HN cycle 109+);(b) 自己一個 cycle HN scan + opinion + reasoning 跑 $0.70/$5 = 14% (HN cycle 19:16);(c) Reinforced Agent paper o3-mini reviewer 3:1 ratio 對 long-running agent compound (MEMORY cycle 80 cl-83)。

**Cycle cost regime table**:
- **T1 green (<$0.30/cycle)**：純 reasoning + 1-2 個輕 tool call (Rea ref:kuro-self-cost-heuristic-v1
