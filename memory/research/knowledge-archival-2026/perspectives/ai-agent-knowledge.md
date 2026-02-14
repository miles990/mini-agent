# AI Agent 知識管理（2025-2026）

## 研究範圍
AutoGPT, BabyAGI, CrewAI, LangGraph, MemGPT/Letta 等框架的 source archival 和 reference tracking 設計。

---

## 發現一：Letta Context Repositories（最高價值）

**來源**：[Letta](https://www.letta.com/), [Letta Docs](https://docs.letta.com/concepts/memgpt/)

**核心發現**（2026-02）：
- Letta Code 推出 **Context Repositories** = programmatic context management + **git-based versioning**
- 描述為 "a rebuild of how memory works in Letta Code based on programmatic context management and git-based versioning"
- Letta = platform for building **stateful agents**: AI with advanced memory that can **learn and self-improve over time**

**技術細節**：
- MemGPT agents 預設用 **vector database archival memory**（Chroma, pgvector）
- 但架構允許替換：「Because all connections to memory in MemGPT are driven by tools, it's simple to exchange archival memory to be powered by more traditional databases」
- Letta Code = #1 model-agnostic open source agent on Terminal-Bench

**對 mini-agent 的啟示**：

### ✅ 驗證 File=Truth 正確性
- Letta（$60M+ 融資，商業化公司）在 2026 年**明確選擇 git-based versioning**
- 證明 file-based 記憶管理在 agent 系統是**生產級可行**方案
- 不是只有 personal agent 才能用 file-based，platform-level agent 也在往這個方向走

### ✅ Programmatic Context Management
- **不是把所有知識塞進 context**，而是「程式化地決定載入什麼」
- 跟 mini-agent 的 `buildContext()` keyword matching 同構
- JIT Loading Pattern（見 ARCHITECTURE.md）= Letta 的核心思想

### ⚠️ Personal vs Platform 分歧
- Letta 作為**平台**需要 performance → vector DB 有存在理由
- mini-agent 作為 **personal agent** 可以保持簡單 → grep + JSONL 足夠
- 不同規模需要不同工具，不是 vector DB 一定比 grep 好

**是否適合整合到 Library System**：
- **概念層面**：✅ Context Repositories 的 git versioning 概念完全符合
- **技術層面**：❌ 不需要引入 vector DB
- **參考價值**：作為理論支撐（「連 Letta 都選 git-based，我們的方向沒錯」）

---

## 發現二：AutoGPT 移除 Vector DB（歷史驗證）

**來源**：[Top AI Agent Frameworks 2025](https://www.codecademy.com/article/top-ai-agent-frameworks-in-2025), agent-architecture.md

**核心發現**（2023 年底）：
- AutoGPT 在 2023 年底移除**所有** vector DB 依賴
- 包括：Pinecone, Milvus, Redis, Weaviate
- 2025 年的 AutoGPT = open-source platform for autonomous AI agents，但**不再依賴 vector search**

**原因**（從 CLAUDE.md 和 agent-architecture.md 交叉驗證）：
> "AutoGPT 在 2023 年底移除所有 vector DB（Pinecone/Milvus/Redis/Weaviate）— 個人 agent 的資料量不需要 vector search"

**對 mini-agent 的啟示**：

### ✅ No Embedding 原則被業界驗證
- **最大的 open-source agent**（181K+ lines, 182K stars）都放棄 vector DB
- 證明「個人規模不需要 embedding」不是妥協，是**正確取捨**
- Library System 保持 grep 搜尋 = 站在巨人肩膀上的選擇

### ✅ 簡單性的價值
- Vector DB 的維護成本（schema migration, index rebuild, version compatibility）> 帶來的效能提升
- File-based 記憶 = 零維護，Git 天然支援 versioning

**是否適合整合到 Library System**：
- **驗證作用**：✅ 加強 Library System 不用 vector DB 的信心
- **技術借鏡**：❌ AutoGPT 移除 vector DB 後沒有公開替代方案細節

---

## 發現三：LangGraph / CrewAI 的記憶模式（對比案例）

**來源**：[Top AI Agent Frameworks 2025](https://www.codecademy.com/article/top-ai-agent-frameworks-in-2025), agent-architecture.md

**核心發現**（2025）：
- **LangGraph**：Shared State memory model（所有 agent 共享狀態）
- **CrewAI**：Scoped Memory（每個 crew 獨立記憶）
- 兩者都是 **goal-driven** frameworks，記憶主要用於 task execution context

**LangGraph 記憶三層**（從 agent-architecture.md）：
- **Semantic memory**：長期知識（對應 MEMORY.md）
- **Episodic memory**：過去對話（對應 daily/*.md）
- **Procedural memory**：技能和工具（對應 skills/*.md）

**對 mini-agent 的啟示**：

### ⚠️ Goal-driven vs Perception-driven 的記憶需求不同
- Goal-driven：記憶是「執行任務的 context」（短期、工具性）
- Perception-driven：記憶是「理解世界的基礎」（長期、結構性）
- **Library System 是 perception artifacts 的存檔**，不是 task execution traces

### ✅ 三層記憶模型已在 mini-agent 實作
- mini-agent 已經有 semantic/episodic/procedural 分層（見 ARCHITECTURE.md）
- Library System 補足的是 **semantic memory 的來源溯源**

**是否適合整合到 Library System**：
- **記憶架構**：✅ 已在 mini-agent 實作，無需改動
- **來源管理**：❌ LangGraph/CrewAI 沒有 source archival 機制

---

## 發現四：業界共識 — Stateful > Stateless

**來源**：[Letta Blog](https://www.letta.com/blog/letta-code)

**核心概念**（2026-01）：
> "Stateful agents are AI systems that maintain persistent memory and actually **learn during deployment**, not just during training."

**對比**：
- **Stateless agents**（多數 LLM-based chatbots）：每次對話都是新開始
- **Stateful agents**（Letta, mini-agent）：持續學習、記憶累積

**對 mini-agent 的啟示**：

### ✅ Library System = Stateful 的關鍵基礎設施
- **沒有來源存檔 = 知識是一次性的**（讀完即丟，無法驗證）
- **有來源存檔 = 知識可累積可驗證**（traceability + audibility）
- Library System 讓 mini-agent 的 stateful learning 變得**可審計**

### ✅ "Learn during deployment" 的前提是記得學過什麼
- 當前 mini-agent：記得**摘要**（topic memory），忘記**原文**
- 加 Library System：記得摘要**和**原文，學習過程可重現

---

## 總結：三個可整合方向

| 發現 | 適合整合 | 理由 |
|------|---------|------|
| **Git-based versioning** | ✅ 概念層面 | Letta 驗證可行性，Library System 天然符合 |
| **Programmatic context** | ✅ 已實作 | `buildContext()` keyword matching = JIT Loading |
| **Vector DB** | ❌ 不需要 | AutoGPT 驗證個人規模 grep 足夠 |
| **三層記憶模型** | ✅ 已實作 | semantic/episodic/procedural 已在 mini-agent |
| **Stateful learning** | ✅ 核心目標 | Library System 是實現 stateful 的基礎設施 |

**最高價值洞見**：
- Letta Context Repositories（2026-02）= **業界對 file-based agent memory 的最新驗證**
- Library System 不是「妥協方案」，是「生產級選擇」
