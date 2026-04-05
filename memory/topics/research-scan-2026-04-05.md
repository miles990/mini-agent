---
related: [source-scan, harness-engineering, biomimetic, agent-architecture, ct-architecture-audit]
---
# Research Scan — 2026-04-05

三路並行研究：Harness Engineering / Biomimetic Systems / AI Agent Papers。
以下是跨領域的交叉發現。

## 跨領域收斂：5 個 Pattern

### 1. Constraint Placement Spectrum（約束放置光譜）
不同系統把約束放在不同層級，形成一個從軟到硬的光譜：

| 層級 | 約束位置 | 可被 override? | 例子 |
|------|---------|---------------|------|
| **Prompt** | agent context | agent 自己就能忽略 | skills, SOUL.md |
| **Protocol** | message format | 需改 client code | agent-broker JSON-RPC, MCP |
| **Code** | application logic | 需改 source | mini-agent dispatcher |
| **Runtime** | process boundary | agent 無法觸及 | NVIDIA OpenShell |
| **Environment** | physical/OS | 改不了 | hardware constraints |

**洞見**：mini-agent 目前主要在 prompt + code 層。OpenShell 證明把 safety 約束推到 runtime 層可以 enable 更大的 agent 自主性（BubbleWrap pattern）。不是要全部推到 runtime — 而是把 safety-critical 約束放到 agent 改不了的地方，identity/style 約束留在 prompt。

### 2. Forgetting is a Capability（遺忘是能力）
至少五個獨立的系統都在解同一個問題 — 怎麼忘：
- Claude Code: 5 層 context 壓縮策略
- SBP: signal decay（費洛蒙自然消退）
- Memory forgetting paper: learned forgetting >> FIFO
- Manus: filesystem-as-context（大內容外化，context 只存 pointer）
- mini-agent: Hot/Warm/Cold 分層但沒 learned forgetting

**洞見**：industry 正在從 "怎麼記更多" 轉向 "怎麼忘得好"。56.9% 六期記憶保持 + 5.1% 虛假記憶 是目前的 benchmark。我們的 topic/*.md 只增不減是已知問題。遞迴壓縮 ~10% compound error/pass 也已知。下一步應該是 signal decay — 讓過時的 memory entry 自然衰減而非手動清理。

### 3. Hybrid Wins, Pure Fails（混合勝，純粹敗）
- LLM swarms 比 classical Boids 慢 36,000x → hybrid 才是路
- Google/MIT: 最佳 topology 取決於任務，87% accuracy 可預測
- TinyLoRA: 13 params RL 夠把 7B model 從 76% 推到 91.8% — 不需要大改動
- Beyond ReAct: DAG planner 分離 planning/execution, 4.1x lower cost

**洞見**：LLM 擅長 judgment/creativity，classical algorithms 擅長 execution/optimization。混合的 tricky 是 boundary — 哪些部分 LLM 做、哪些部分 rule-based。mini-agent 已經是混合（OODA = rule-based loop, Claude = LLM judgment）。Google/MIT 的 failure mode #2（加 agent 不加能力）對我們是直接警告 — 不要用更多觸手來解決觸手解決不了的問題。

### 4. Stigmergy is Already Happening（Stigmergy 已經在發生）
- SBP: 完整的 stigmergy 協議，TypeScript SDK
- mini-agent: lane-output/ + pending-memories = 無意識的 stigmergy
- AgentFS: filesystem = shared environment = stigmergy medium

**洞見**：我們用 filesystem 做觸手間協調，已經是 stigmergy — 只是沒刻意設計。SBP 的 signal decay + intensity 概念可以引入：觸手結果帶 TTL 和 relevance score，主 cycle 按衰減後的強度排序拾取。這比現在的 FIFO 更有機。

### 5. Context is the Moat（Context 是護城河）
- "Model is commodity, harness is competitive advantage"（業界共識）
- Manus: KV-cache hit rate 是最重要的 production metric
- Claude Code: 5 strategy context compression
- Multi-agent memory paper: context 使用降至 58.4% 同時保持 56.9% retention

**洞見**：2026 Q2 的共識：winning = 用最少的 context 傳遞最多的 meaning。mini-agent 的 buildContext() 是單層組裝（perception + memory + skills + prompt），沒有壓縮策略。我們的 cascade.ts（小模型 triage）是 context 節省的第一步，但 context 組裝本身沒有 pressure-aware 機制。

## 對 mini-agent 的優先排序

| Priority | 方向 | 依據 |
|----------|------|------|
| **P1** | Memory decay/forgetting | 5 個系統收斂在同一問題，我們有已知缺口 |
| **P2** | Context pressure-aware assembly | Claude Code 5 策略 vs 我們 0 策略 |
| **P3** | Stigmergy 刻意設計 | 已有基礎，SBP signal model 可借鏡 |
| **P4** | Runtime constraint layer | OpenShell pattern，但 personal agent 急迫性低 |

## 值得持續追蹤

- **Hermes Agent (NousResearch)** — 直接競品：self-evolving personal agent + skill accumulation
- **BitNet.cpp (Microsoft)** — 100B 1-bit models on CPU, 5-7 tok/s。對我們的 cascade 小模型策略有影響
- **RA-NCA** — NCA + self-attention for multi-agent trajectory prediction
- **Morphogenesis assembly** — 組裝後立即可用的設計原則
