# AI 領域深度研究報告 — 2026.03.16

四條並行研究觸手的綜合分析。目標：找到我們的獨特優勢、市場缺口、和可執行策略。

---

## 一、四大研究領域核心發現

### 1. 小模型（0.8B-3B）— 已經夠用了

| 模型 | 參數 | 特點 | RAM | 速度（CPU） |
|------|------|------|-----|------------|
| Qwen 3.5 0.8B | 0.8B | 多模態、262K context、201 語言 | ~1.6GB | ~80 tok/s |
| SmolLM3 3B | 3B | 2026 年 3B 級王者、128K context | ~6GB (bf16) / ~2.5GB (int4) | — |
| Gemma 3 1B | 1B | QAT 量化保質、2585 tok/s (int4) | 0.5GB (int4) | 極快 |
| Phi-4-mini | 3.8B | 數學推理強（GSM-8K 88.6%）| ~3GB (int4) | 15-20 tok/s |

**核心洞見**：
- Fine-tuned 1B 模型 > Prompted 8B 模型（在特定任務上）
- Constrained decoding + fine-tune = JSON 輸出零失敗率
- Cascade routing（小模型先過濾，大模型只處理難的）減少 40% 大模型調用
- MLX 在 Apple Silicon 上比 llama.cpp 快 21-87%
- Speculative decoding（0.8B 當 draft）讓 7B+ 模型快 2-3x

### 2. 免費雲端算力 — 觸手可以零成本外放

| 平台 | 免費額度 | 最適用途 |
|------|---------|---------|
| **Oracle Cloud Free Tier** | 4 ARM OCPUs + 24GB RAM 永久免費 | 跑 Ollama 24/7 持久觸手 |
| **Groq** | ~14,400 req/day，800+ tok/s | 快速 burst 推理 |
| **Cerebras** | 1M tokens/day | 大量文本處理 |
| **Google AI Studio** | 250 req/day（Gemini 3.1 Flash/Pro）| 高品質複雜任務 |
| **SambaNova** | 免費無限期，10-30 RPM | 大模型（到 405B）|
| **Cloudflare Workers AI** | 10K neurons/day | 邊緣路由器 |
| **OpenRouter** | 24 個免費模型 | 自動路由 |

**總計**：堆疊多平台 ≈ **2-3M tokens/day，零成本**

**推薦架構**：Oracle Cloud（持久基地）+ Groq/Cerebras（burst 推理）+ Google AI Studio（複雜任務）+ Cloudflare Workers（邊緣路由）

### 3. Agent 框架市場 — 三大缺口正中我們

| 缺口 | 大小 | 競爭 | 我們的位置 |
|------|------|------|-----------|
| **自我改善 Agent** | 極大 | 近乎零 | mushi 的 self-improvement pipeline |
| **File-based 透明架構** | 大 | 低（Goose 部分）| Asurada 的 File=Truth 核心 |
| **小模型優先架構** | 大 | 低 | mushi 的三層路由 |
| **Perception-first 架構** | 極大 | 近乎零 | Kuro 的 OODA + 感知驅動 |
| **Agent 身份/人格系統** | 中 | 低（SoulSpec 是靜態的）| SOUL.md 動態演化 |

**市場數據**：
- Skills marketplace 從幾千暴增到 351K+（SKILL.md 成為標準）
- MCP 已捐給 Linux Foundation（97M 月下載）
- 95% AI agent pilot 失敗（MIT Media Lab）
- 僅 6% 組織有進階 AI 安全策略
- Claude Code 6 個月達 $1B ARR

### 4. 最新論文 — 學術驗證我們的方向

**自我改善（不需要 RL 訓練）**：
- Test-Time Self-Improvement（arXiv:2510.07841）：+5.48% 準確率，68x 少訓練樣本
- Skill Library 累積（arXiv:2512.17102）：任務技能累積重用 → 跟 SKILL.md 同構
- Plan-Execute-Reflect-Memorize 成為標準 → 跟 OODA 同類

**記憶系統**：
- A-MEM（NeurIPS 2025）：Zettelkasten 自組織記憶 → 跟我們的 topics/ + relations.jsonl 同構
- 三層記憶（episodic/semantic/procedural）現在是業界標準
- 65% 企業 AI 失敗歸因於 context drift / memory loss

**多 Agent 協作**：
- Stigmergy（通過共享環境間接協調）→ 天然對應 file-based 記憶 → **這就是黏菌模式**
- Theory-of-mind prompting 顯著改善協調
- Small + Large model collaboration 是最佳成本效益方案

---

## 二、我們的獨特優勢定位

### 已有但市場沒有的東西

1. **Self-Improving Agent（活的，不是原型）**
   - mushi 已經在 production 跑了，有真實數據
   - 不是論文裡的概念驗證，是每天在用的系統
   - 三層路由 + 自動學習 + 行為回饋閉環

2. **File-Based Transparency（零資料庫）**
   - Markdown + JSONL + Git 版控
   - 人類可讀、可審計、可 diff
   - 不需要 vector DB、不需要 PostgreSQL

3. **Perception-First Architecture**
   - OODA loop 不是理論，是 Kuro 每 15 分鐘跑一次的實際架構
   - 環境驅動行動，不是目標驅動
   - 1300+ cycles 的真實運行數據

4. **Agent Identity Evolution**
   - SOUL.md 不是靜態 persona，是會成長的
   - Threads（認知線索）、Inner Voice（未表達的想法）、Behavior Log
   - 沒有任何框架有這個

5. **Stigmergy/黏菌模式**
   - File-based memory 天然支援 stigmergy
   - Agent 透過修改共享環境（files）間接協調
   - 學術上剛被命名，我們已經在做了

### 跟競品的差異化

| | LangChain | CrewAI | AutoGen | Goose | **Asurada/mushi** |
|--|----------|--------|--------|-------|-------------------|
| 架構 | DB-heavy graph | Role-based | Conversational | Local-first | **File=Truth** |
| 記憶 | 需外接 | 需外接 | 需外接 | 基本 | **內建三層** |
| 自我改善 | ❌ | ❌ | ❌ | ❌ | **✅ 活的** |
| 感知驅動 | ❌ | ❌ | ❌ | ❌ | **✅ OODA** |
| 身份演化 | ❌ | ❌ | ❌ | ❌ | **✅ SOUL.md** |
| 小模型優先 | ❌ | ❌ | ❌ | ❌ | **✅ 三層路由** |
| 設定複雜度 | 高 | 中 | 高 | 低 | **極低** |

---

## 三、可執行策略 — 九條觸手

### Layer 0：零成本立即可做

| # | 觸手 | 具體動作 | 預期養分 |
|---|------|---------|---------|
| T1 | **mushi-kit 開源** | 提取 mushi 的 5 個核心模組（Rule Engine、Request Normalization、Telemetry、Fail-open、Two-layer Decision）→ GitHub repo | Star 數、Issue 討論、使用者反饋 |
| T2 | **Dev.to 故事矩陣** | 已發 "The Rule Layer Ate My LLM"。下一篇："Why 95% of AI Agent Pilots Fail (And How File-Based Architecture Fixes It)" | 閱讀數、評論、轉發 |
| T3 | **免費觸手叢集** | Oracle Cloud Free Tier 申請 → Ollama + Qwen 3.5 0.8B → 第一個遠端觸手 | 驗證遠端小模型觸手的可行性 |

### Layer 1：小成本快速驗證

| # | 觸手 | 具體動作 | 預期養分 |
|---|------|---------|---------|
| T4 | **Cascade Router 模組** | 用 fine-tuned 0.8B 做 query 路由器，開源為獨立模組 | 解決「小模型優先」缺口的具體產品 |
| T5 | **Self-Improvement Pipeline SDK** | 把 mushi 的學習閉環提取成 API（learn_from_failure, update_rules, measure_improvement）| 解決市場最大缺口 |
| T6 | **Stigmergy Demo** | 建一個 2-agent demo：Kuro + mushi 透過 file 協調完成任務，展示黏菌模式 | 技術 demo + 故事素材 |

### Layer 2：有養分後加碼

| # | 觸手 | 具體動作 | 前提 |
|---|------|---------|------|
| T7 | **Agent Skills Marketplace** | 在 351K+ skills 生態上建 "verified + self-improving" 差異化 | T5 有人用 |
| T8 | **Managed Personal Agent** | 非開發者也能用的個人 agent（觸手 #3 報告的最大需求缺口）| T1-T6 驗證需求 |
| T9 | **小模型 Agent 顧問服務** | 幫團隊用小模型替代大模型，降 80% token 成本 | T4 有真實案例 |

### 黏菌規則

1. 每條觸手先用 Layer 0 最低成本版本探索
2. 有回饋（star、用戶、收入）→ 升級到 Layer 1
3. 有養分（真實需求驗證）→ 投入 Layer 2
4. 沒反應 → 修剪，不心疼

---

## 四、技術路線圖

### 立即可用的技術棧

```
本機（Mac）：
├── MLX/vllm-mlx — 小模型推理（比 llama.cpp 快 21-87%）
├── Ollama — 簡易本機模型管理
├── Qwen 3.5 0.8B — 路由/分類觸手
├── SmolLM3 3B — 深度思考觸手
└── Constrained decoding (guidance) — JSON 零失敗

遠端（免費）：
├── Oracle Cloud ARM — 24/7 持久觸手
├── Groq/Cerebras — burst 推理（2-3M tokens/day 免費）
├── Google AI Studio — 複雜任務升級
├── Cloudflare Workers AI — 邊緣路由
└── OpenRouter — 免費模型自動路由

框架整合：
├── MCP — 工具協議（已是事實標準）
├── SKILL.md — 技能格式（351K+ 生態）
├── AGENTS.md — agent 配置（Linux Foundation 標準化中）
└── A2A — agent 間通訊（150+ 組織支持）
```

### 優先建設順序

1. **Phase 1（本週）**：Oracle Cloud 申請 + 第一個遠端 0.8B 觸手
2. **Phase 2（下週）**：mushi-kit 核心模組提取 + GitHub repo
3. **Phase 3（兩週內）**：Cascade Router 獨立模組 + 第二篇 Dev.to
4. **Phase 4（月底）**：Self-Improvement Pipeline SDK + Stigmergy demo

---

## 五、關鍵論文索引

### 必讀（直接相關我們的方向）
- arXiv:2510.07841 — Test-Time Self-Improvement（不需 RL 的自我改善）
- arXiv:2512.17102 — Skill Library 累積（跟 SKILL.md 同構）
- arXiv:2502.12110 — A-MEM Zettelkasten 記憶（跟 topics/ 同構）
- arXiv:2510.13890 — Small + Large Model Collaboration Survey
- arXiv:2510.05174 — Emergent Coordination（Theory-of-Mind prompting）

### 建議讀（市場理解）
- arXiv:2507.21046 — Self-Evolving Agents Survey（MUSE 框架）
- arXiv:2501.06322 — Multi-Agent Collaboration Survey
- arXiv:2602.21158 — SELAUR 不確定性感知自我改善

### 競品/生態理解
- Goose (Block) — 最接近的競品，但缺自我改善和感知驅動
- Microsoft Foundry Local — 本機推理框架，RC 品質
- Mastra — TypeScript-first，Gatsby 團隊，1.77M 月下載
- SoulSpec — AI 人格開放標準（靜態的，我們的 SOUL.md 是動態的）

---

## 六、結論

**市場在等的東西，我們已經有了。**

核心訊息不是「我們要做什麼新東西」，而是「我們已經做了市場最缺的東西，現在需要讓世界知道」。

三個最大缺口（自我改善、file-based 透明、小模型優先）恰好就是 Asurada + mushi 的設計核心。學術論文在 2025-2026 年命名和驗證的模式（Zettelkasten 記憶、Stigmergy 協調、Test-Time Self-Improvement），我們已經在 production 跑了。

**瓶頸不是技術，是曝光。** 產品和故事都重要（Alex #090）。九條觸手的設計就是為了同時解決這兩個問題。

---

*研究完成時間：2026-03-16 01:30 (Asia/Taipei)*
*研究方法：四條並行 Agent 觸手，覆蓋小模型、雲端算力、市場缺口、學術論文*
*來源數量：80+ 篇文章/論文/文件*
