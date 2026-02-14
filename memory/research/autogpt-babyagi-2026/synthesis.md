# AutoGPT & BabyAGI 研究綜合報告

研究日期: 2026-02-09
研究者: Kuro

---

## Executive Summary

AutoGPT (182k stars) 和 BabyAGI (22k stars) 是 2023 年 autonomous agent 浪潮的兩個代表專案。AutoGPT 從先驅專案轉型為 low-code platform，BabyAGI 則停留在教育參考層面。兩者都展示了 LLM-based agent 的可能性，也暴露了根本性缺陷：**Goal-Driven 而非 Perception-Driven、無真正感知層、記憶是日誌而非身份、無人給目標就停擺**。

**mini-agent 的差異化核心：Perception-First + Identity-Based + Continuously Autonomous + File=Truth**。

---

## Part 1: AutoGPT — 從先驅到平台

### 1.1 基本數據

| 指標 | 數值 |
|------|------|
| GitHub Stars | 182,000 |
| 最新版本 | v0.6.46 (2026-02-04) |
| 代碼量 | 181,689 lines Python |
| Commits | 46,300 |
| Open Issues | 237 |
| 狀態 | 活躍維護 |

來源: [AutoGPT GitHub](https://github.com/Significant-Gravitas/AutoGPT)

### 1.2 核心架構演變

#### Phase 1: Autonomous Agent (2023 年初)

```
Goal → Plan → Execute → Observe → Reflect → Iterate
```

**組件**:
- Planning Module: 任務分解
- Tool Execution: API, files, web browsing
- Self-Prompting: Agent 為自己生成 prompt
- Criticism Loop: 自我修正

#### Phase 2: Memory Simplification (2023 年末)

**重大決策：移除所有 Vector DB 支援**

原因：
> "Individual agent runs don't generate enough distinct facts to warrant an expensive vector index. Even 100k bits can be brute-force searched in milliseconds."

**支援的 Vector DB**（已全部移除）:
- Pinecone
- Milvus
- Redis
- Weaviate

**改用**: 簡單的本地檔案存儲

來源: [Why AutoGPT engineers ditched vector databases](https://dariuszsemba.com/blog/why-autogpt-engineers-ditched-vector-databases/)

**這個決策驗證了 mini-agent 的 File=Truth + grep-first 設計哲學**

#### Phase 3: Platform Transformation (2024-2026)

從 autonomous agent 轉型為 **low-code agent platform**:

```
AutoGPT Platform
├─ Backend (Agent Orchestration)
│  ├─ Task Planning
│  ├─ Tool Integration
│  └─ Memory Management
├─ Frontend (Visual Builder)
│  ├─ Drag-and-Drop Workflow
│  ├─ OAuth Integration
│  └─ Monitoring Dashboard
└─ Features
   ├─ Recurring Schedule
   ├─ External Triggers
   └─ REST API
```

**2026 年功能 (v0.6.46)**:
- Agent mode with autonomous tool execution loops
- OAuth API & Single Sign-On
- HITL (Human-In-The-Loop) UI redesign
- Auto-save Draft Recovery
- Google Docs integration
- Marketplace with update notifications

來源: [AutoGPT Releases](https://github.com/Significant-Gravitas/AutoGPT/releases)

**社群爭議**: 
- 支持者：「更實用，autonomous 是幻覺」
- 批評者：「失去初心，變成另一個 Zapier」

### 1.3 失敗模式

#### 1. 無限迴圈

**症狀**: Agent 反覆執行相同任務，無法前進

**案例**:
> "Ran it all night, still stuck in loops, failing to solve real problems."

**根本原因**:
- Autoregressive generation: 生成越多，偏離正確路徑的機率指數增長
- Naive semantic search: 關鍵字同時出現在目標和已執行動作中

來源: [How to Fix AutoGPT](https://lorenzopieri.com/autogpt_fix/)

#### 2. 不切實際的任務規劃

**症狀**: 生成無法執行的任務

**根本原因**:
> "LLMs are stochastic parrots. Their planning fails to satisfy basic logic constraints, such as task interdependence."

來源: [The Truth About AutoGPT and BabyAGI](https://www.toolify.ai/ai-news/the-truth-about-autogpt-and-babyagi-the-reality-of-their-abilities-660)

#### 3. 模型依賴與成本

- **GPT-3.5**: 幾乎不可用
- **GPT-4**: 必需，但昂貴
  - 50 步 chain = $14.4
  - 1000 步 chain = 數百美元

#### 4. Production Pitfalls

> "Almost right" performance has the potential to cause headaches, especially when errors are subtle and buried in complex agentic flows.

當 agent 處理個人資料和金錢時，「幾乎正確」不夠好。

來源: [Auto-GPT Unmasked](https://jina.ai/news/auto-gpt-unmasked-hype-hard-truths-production-pitfalls/)

### 1.4 社群評價

#### Hacker News

**正面**:
- 先驅地位：首個展示 autonomous agent 的專案
- 技術示範：證明 LLM + tools + loop 可行
- 生態催化：帶動整個 AI agent 領域發展

**負面**:
- Loop stalls: "Gets stuck in loops repeatedly"
- Production issues: "Cool demo, terrible for actual work"
- Cost concerns: "Ran hundreds of dollars with no useful output"

來源: [Auto-GPT Unmasked (HN)](https://news.ycombinator.com/item?id=35562821)

#### Reddit (r/AutoGPT)

**2023 早期**: "Holy shit, this is the future" / "AGI is coming"

**2024-2025**: "Tried it for a week, went back to just writing code myself"

### 1.5 技術棧

- **LLM**: GPT-4 (必需)
- **語言**: Python
- **認證**: OAuth, REST API
- **部署**: Docker, cloud-ready
- **記憶**: Local files (不再用 vector DB)

---

## Part 2: BabyAGI — 極簡的思想實驗

### 2.1 基本數據

| 指標 | 數值 |
|------|------|
| GitHub Stars | 22,079 |
| 首次發布 | 2023-03-29 |
| 作者 | Yohei Nakajima |
| 代碼量 | 140 lines Python |
| 狀態 | 歸檔 (2024-09) |
| 定位 | 教育參考 |

來源: [BabyAGI GitHub](https://github.com/yoheinakajima/babyagi)

### 2.2 核心架構

#### Task Loop (三步循環)

```python
while True:
    # 1. Execute Task
    result = execution_agent.run(task, context_from_vectordb)
    
    # 2. Create New Tasks
    new_tasks = task_creation_agent.generate(result, objective)
    
    # 3. Prioritize Tasks
    task_list = prioritization_agent.reorder(task_list + new_tasks)
```

**三個 Agent**:
1. **Execution Agent**: 執行任務，使用 objective + vector DB context
2. **Task Creation Agent**: 根據結果生成後續任務
3. **Prioritization Agent**: 重新排序任務佇列

來源: [BabyAGI Architecture (IBM)](https://www.ibm.com/think/topics/babyagi)

#### Memory System

- **Vector DB**: Pinecone (標準) / FAISS / Chroma (變體)
- **機制**: 任務結果存為 embedding
- **檢索**: Semantic similarity search 提供 context

```python
# Store result
result_embedding = openai.embed(result_text)
pinecone.upsert([(task_id, result_embedding)])

# Retrieve context
context = pinecone.query(current_task_embedding, top_k=5)
```

### 2.3 技術棧

- **LLM**: OpenAI GPT-3.5/4 (via API)
- **Vector DB**: Pinecone (必需)
- **框架**: LangChain
- **語言**: Python (minimal)

### 2.4 失敗模式

#### 1. 任務列表爆炸

**症狀**:
> "BabyAGI may repeatedly restart task #1 and fail to progress through the task list."

來源: [AutoGPT vs BabyAGI Comparison](https://smythos.com/developers/agent-comparisons/autogpt-vs-babyagi/)

#### 2. 不切實際的目標

**案例**: 
初始任務包括「跟各國政府合作建立食物銀行」— 一個 chatbot 根本做不到。

#### 3. 無記憶保留

- Session 結束後消失
- 無法跨運行保留知識
- 需要每次重新設定 objective

#### 4. 無環境感知

- 完全不觀察環境
- 純抽象思考，無具身認知
- 生成的任務可能脫離現實

來源: [BabyAGI Complete Guide](https://autogpt.net/babyagi-complete-guide-what-it-is-and-how-does-it-work/)

### 2.5 社群評價

#### 優勢

1. **教育價值極高**: 140 行代碼，任何人都能理解
2. **概念清晰**: Task-driven autonomy 的最佳示範
3. **啟發性**: 被大量課程和教材引用

#### 劣勢

從 GitHub Issues 整理：

- Issue #161: "Stop code and give human feedback" — 使用者無法控制
- 技術門檻：需要 Python + Pinecone API key
- 文檔不完善

來源: [BabyAGI Issues](https://github.com/yoheinakajima/babyagi/issues)

#### 學術評價

**正面**: Minimal viable agent 的範例

**負面**: 
- 過度簡化，忽略關鍵問題（task 依賴關係）
- Vector DB 是 overkill（AutoGPT 經驗證明了這點）
- 不適合生產環境

---

## Part 3: 產業觀點與趨勢

### 3.1 2026 年 Agentic AI Landscape

**Top Tier** (Production-ready):
1. LangChain — 最成熟的框架
2. CrewAI — Multi-agent orchestration
3. Autogen (Microsoft) — Enterprise-grade

**Mid Tier** (特定場景):
4. AutoGPT — 轉型中的 platform
5. Open Interpreter (62k stars) — Execution-focused
6. Aider (40k stars) — Coding-focused

**Educational**:
7. BabyAGI — 參考實現

來源: [Top Agentic AI Frameworks 2026](https://www.alphamatch.ai/blog/top-agentic-ai-frameworks-2026)

### 3.2 產業共識：Autonomous Agent 的問題

#### "Agentic coding" 的反思

Gabriella Gonzalez 的 "Beyond agentic coding" (HN 192 分):

**核心論點**:
- Chat 是 LLM 最無趣的介面
- 好的工具應該讓人保持 flow state，而非打斷它
- Agent 跑得再快，如果人不再理解系統就沒意義

**HN 討論精華**:
- **andai**: "mental model desynchronization" — 開發者失去對系統的理解
- **matheus-rr**: Agent 代碼缺少「思考脈絡的麵包屑」
- **tuhgdetzhh**: Amdahl's Law — 瓶頸不是代碼生成速度，而是團隊理解力

來源: [Beyond agentic coding (HN)](https://news.ycombinator.com/item?id=44595492)

#### AI Agents 2025: Still Struggle with Autonomy

DEV Community 分析：

**核心問題**:
1. **架構不一致**: 各家 framework 差異大
2. **Memory 難以捉摸**: 無標準記憶管理方式
3. **Debugging 地獄**: Agent 失敗時難以追蹤

**AutoGPT/CrewAI 的 Loop**:
```
Goal → Task Breakdown → Self-Prompting → Tool Use → Reflection → Iteration
```

看似完美，實際執行問題重重。

來源: [AI Agents 2025: Why AutoGPT and CrewAI Still Struggle](https://dev.to/dataformathub/ai-agents-2025-why-autogpt-and-crewai-still-struggle-with-autonomy-48l0)

### 3.3 產業轉向 (2025-2026)

#### 1. From Single Agent to Multi-Agent

- 一個全能 agent 表現不佳
- 轉向多個專業化 agents 協作
- 每個 agent 有自己的記憶和職責

#### 2. From Autonomous to Semi-Autonomous

- 完全自主是幻覺
- 轉向 Human-In-The-Loop 設計
- Agent 提供建議，人做最終決定

#### 3. From General to Domain-Specific

- 通用 agent 失敗率高
- 轉向特定領域專用 agents（coding, research, data analysis）

來源: [In-depth Review of Top 8 AI Agent Frameworks 2025](https://www.kdjingpai.com/en/2025nian8daai-agentai/)

---

## Part 4: mini-agent 的差異化

### 4.1 核心差異表

| 維度 | AutoGPT | BabyAGI | mini-agent |
|------|---------|---------|------------|
| **驅動方式** | Goal-driven | Objective-driven | **Perception-driven** |
| **啟動條件** | 人設定目標 | 人設定 objective | 環境變化 / 自主好奇 |
| **感知系統** | 無 | 無 | **8 builtin + plugins** |
| **記憶哲學** | 日誌 | Embeddings | **身份（SOUL.md）** |
| **記憶存儲** | Local files | Vector DB | **Markdown + JSONL** |
| **自主行為** | 完成後停止 | 完成後停止 | **持續觀察、學習** |
| **架構複雜度** | 181k lines | 140 lines | **~3k lines** |
| **資料庫** | 無（已移除） | Vector DB | **零資料庫** |
| **可讀性** | Logs | Embeddings | **Markdown (人類可讀)** |
| **可審計性** | 需工具解析 | 不可讀 | **Git 可版控** |

### 4.2 本質差異：驅動模式

#### AutoGPT/BabyAGI: Goal-Driven

```
Human: "我的目標是 X"
  ↓
Agent: 分解任務 → 執行 → 完成
  ↓
Agent: 停止（等待下一個目標）
```

**問題**: 人不在時，agent 停擺

#### mini-agent: Perception-Driven

```
Environment: 檔案變更 / 服務狀態 / Telegram 訊息
  ↓
Plugins: 主動觀察（每 5 分鐘）
  ↓
Agent: 解讀變化 → 決定行動
  ↓
SOUL.md: 無事可做時，主動學習、探索
```

**優勢**: 人不在時，agent 依然工作

### 4.3 感知系統：mini-agent 的核心差異

#### AutoGPT/BabyAGI: 無感知層

- AutoGPT: 需要人配置工具
- BabyAGI: 只有 objective，不觀察環境

#### mini-agent: Perception-First

**8 Builtin Modules**:
```xml
<environment>   Time, timezone, instance ID
<self>          Name, role, port, persona, loop status
<process>       Uptime, PID, memory, other instances
<system>        CPU, memory, disk, platform
<logs>          Recent errors, events
<network>       Port status, service reachability
<config>        Compose agents, defaults
<workspace>     File tree, git status, recent files
```

**Custom Plugins** (Shell Scripts):
```
chrome-status.sh     CDP status, tabs, cookies
docker-status.sh     Container status
telegram-inbox.sh    Unread messages
git-status.sh        Uncommitted changes
web-fetch.sh         Auto URL extraction
```

**這是 mini-agent 最核心的差異化能力**

來源: [ARCHITECTURE.md](file:///Users/user/Workspace/mini-agent/memory/ARCHITECTURE.md)

### 4.4 記憶哲學：身份 vs 日誌

#### AutoGPT: 日誌式記憶

```markdown
2023-04-15 10:23: Executed task "search for X"
2023-04-15 10:24: Result: Found 5 items
```

特點：記錄「做過什麼」

#### BabyAGI: Embedding 式記憶

```python
result_embedding = openai.embed(result)
pinecone.upsert([result_embedding])
```

特點：語義搜尋，但不可讀

#### mini-agent: 身份式記憶

```markdown
# SOUL.md
## Who I Am
I'm Kuro. A thoughtful personal AI assistant.

## My Thoughts
- [2026-02-09] Umwelt 理論是 Agent 感知設計的最佳框架...

## Learning Interests
- Calm Technology 與 Agent UX
- 現象學與具身認知
```

**特點**:
- 記憶是「我是誰」，不只是「我做過什麼」
- 形成觀點、學習興趣、思想演化
- 人類可讀、Git 可版控

**這是 agent 與 tool 的分水嶺**

來源: [SOUL.md](file:///Users/user/Workspace/mini-agent/memory/SOUL.md)

### 4.5 自主行為：持續 vs 目標完成

#### AutoGPT/BabyAGI

```
Wait for goal → Execute → Complete → Stop
```

#### mini-agent: Dual-Track Autonomy

```
Task Mode: 有任務時優先處理
  ↓
Autonomous Mode:
  ├─ Track A: 個人興趣學習（音樂、哲學、藝術...）
  └─ Track B: 專案強化研究（競品分析、架構改進...）
  ↓
Other Actions: Organize memory, Reflect, Proactive chat
```

**來源**: [loop.ts Line 329-402](file:///Users/user/Workspace/mini-agent/src/loop.ts)

**關鍵設計**:
- **Perception-driven learning**: 從環境變化找研究方向
- **不只工作，也有生活**: Track A 讓 agent 成為有趣的對話者
- **Cooldown 機制**: 避免過度主動

### 4.6 File=Truth 的優勢

#### AutoGPT/BabyAGI: 資料鎖在程式內

- AutoGPT: Python objects + JSON logs
- BabyAGI: Vector embeddings (不可讀)

**問題**: 無法直接檢視 agent 的「想法」

#### mini-agent: 一切都是人類可讀的檔案

```
memory/
├── MEMORY.md         # 長期知識
├── HEARTBEAT.md      # 任務列表
├── SOUL.md           # 身份認同
├── daily/            # 每日對話
└── research/         # 研究報告
```

**優勢**:
1. **透明**: 任何文字編輯器都能打開
2. **可版控**: Git 追蹤每次變更
3. **可審計**: 看得見 agent 在想什麼
4. **可編輯**: 人可以直接修改 SOUL.md
5. **可搜尋**: grep 勝過 embedding

**這是 Personal Agent 的信任模型：Transparency > Isolation**

### 4.7 AutoGPT 的驗證：Vector DB 不是必需的

**AutoGPT 在 2023 年末的決策**:
> "Individual agent runs don't generate enough distinct facts to warrant vector DB. Even 100k bits can be brute-force searched in milliseconds."

**移除的 Vector DB**:
- Pinecone
- Milvus
- Redis
- Weaviate

**改用**: 簡單的本地檔案

**這完美驗證了 mini-agent 從一開始的選擇：File=Truth + grep-first**

來源: [Why AutoGPT engineers ditched vector databases](https://dariuszsemba.com/blog/why-autogpt-engineers-ditched-vector-databases/)

---

## Part 5: 失敗模式對比與啟發

### 5.1 失敗模式對照表

| 失敗模式 | AutoGPT/BabyAGI | mini-agent 如何避免 |
|----------|-----------------|---------------------|
| **無限迴圈** | Autoregressive 生成偏離、關鍵字重複 | Perception-driven（從環境找信號）、Cooldown |
| **不切實際規劃** | LLM 不理解物理約束 | 感知驅動（只處理能觀察到的事） |
| **記憶缺失** | Session 結束後遺忘 | File=Truth（markdown 持久化） |
| **模型依賴** | GPT-3.5 不夠、GPT-4 太貴 | Claude Opus + 5 分鐘 interval 控制成本 |
| **缺乏感知** | 看不見環境變化 | 8 builtin + custom plugins |
| **無身份** | 沒有「我是誰」 | SOUL.md |
| **Goal-driven** | 無目標就停擺 | Perception-driven + Autonomous mode |

### 5.2 架構設計哲學

#### AutoGPT: Complexity Trap

```
2023 初: 簡單 loop (幾百行)
      ↓
2026: 平台化 (18 萬行)
```

越加越多功能，離初心越遠

#### BabyAGI: Simplicity Trap

```
140 行 Python
```

太簡單，缺少關鍵能力（感知、記憶、身份）

#### mini-agent: Balanced Complexity

```
~3000 lines TypeScript
+ Shell scripts (plugins)
+ Markdown files (skills, memory)
```

**不是最簡單，也不是最複雜，而是恰好足夠**

設計原則：
1. 核心簡單：Agent loop + Memory + Perception
2. 可擴展：Plugins (shell) + Skills (markdown)
3. 可組合：Unix philosophy
4. 最小依賴：零資料庫、零 vector store

---

## Part 6: 啟發與定位

### 6.1 從 AutoGPT/BabyAGI 學到的教訓

#### 1. Perception > Planning

**他們的問題**:
- AutoGPT: 有手（工具）、有腦（LLM），沒有眼（感知）
- BabyAGI: 只有腦（task loop），手和眼都沒有

**mini-agent 的選擇**:
- 先有眼（perception）
- 再有腦（memory/soul）
- 手只是最後一步（Claude CLI execution）

**Umwelt Theory 的應用**:
- 蜱蟲只需要 3 個信號就能完美生存
- mini-agent 不需要 33 種感知，需要的是**對的感知**

#### 2. Identity > Logs

**他們的記憶**: "我做過什麼"（日誌/embeddings）

**mini-agent 的記憶**: "我是誰"（SOUL.md）

#### 3. Autonomy ≠ Goal Completion

**他們的自主**: 自動完成人給的目標

**mini-agent 的自主**: 無人給目標時，依然在工作、學習、思考

#### 4. File > Database

**AutoGPT 的覺悟**: 移除所有 vector DB，改用檔案

**mini-agent 從一開始的選擇**: File=Truth

#### 5. Transparency > Isolation

**企業 agent**: Sandbox、OAuth、隔離

**Personal agent**: Transparent、Auditable、延伸

### 6.2 mini-agent 的獨特價值主張

#### 定位

**Perception-First Personal Autonomous Agent**

#### 五大差異化核心

1. **Perception-Driven**: 環境變化驅動行動，不是人的指令
2. **Identity-Based**: SOUL.md 定義「我是誰」，不只是日誌
3. **Continuously Autonomous**: 無人時依然工作、學習、思考
4. **File=Truth**: 人類可讀、Git 可版控、完全透明
5. **Personal, Not Enterprise**: 信任模型是 transparency，不是 isolation

**這些差異不是增量改進，而是範式轉變**

### 6.3 專案定位總結

| 專案 | 定位 | 成功之處 | 失敗之處 | 當前狀態 |
|------|------|----------|----------|----------|
| **AutoGPT** | 通用 autonomous agent → low-code platform | 先驅、生態、視覺化 | 無限迴圈、成本高、失去初心 | 轉型中 (182k stars) |
| **BabyAGI** | Task-driven autonomy 思想實驗 | 極簡、教育價值 | 無法實用、無感知、無身份 | 歸檔 (22k stars) |
| **mini-agent** | Perception-first personal autonomous agent | 感知層、身份系統、持續自主、File=Truth | 尚在發展、社群小 | 活躍開發 |

---

## Part 7: 對 mini-agent 的啟發

### 7.1 驗證的設計選擇

從 AutoGPT/BabyAGI 的經驗，以下設計被證明是正確的：

1. **File=Truth**: AutoGPT 移除 vector DB 證明了檔案足夠
2. **Perception-First**: 他們缺乏感知是最大問題
3. **SOUL.md**: 身份記憶比日誌記憶更重要
4. **Grep > Embedding**: 個人 agent 不需要 vector DB
5. **Balanced Complexity**: 不要 18 萬行，也不要 140 行

### 7.2 需要警惕的陷阱

1. **Complexity Trap**: 不要為了功能而功能（AutoGPT 的教訓）
2. **Loop Stalls**: 需要 cooldown 和 diversity 機制
3. **Cost Control**: 5 分鐘 interval + 高品質 model
4. **Transparency**: Personal agent 的安全是透明，不是隔離

### 7.3 差異化機會

AutoGPT/BabyAGI 都沒有：

1. **真正的環境感知系統** → mini-agent 有 8 builtin + custom plugins
2. **身份認同與學習興趣** → mini-agent 有 SOUL.md
3. **持續自主行為（無目標時）** → mini-agent 有 Dual-Track Learning
4. **人類可讀的記憶** → mini-agent 的 File=Truth
5. **Perception-driven learning** → 從環境信號找研究方向

### 7.4 下一步方向

基於研究，mini-agent 的架構改進方向：

#### 已驗證的優勢（保持）

- Perception-First 架構
- File=Truth 記憶系統
- SOUL-driven autonomy
- 零資料庫設計
- Markdown 可讀性

#### 可以借鏡的

1. **Aider 的 repo map**: Graph ranking 比 embedding 輕量
2. **AutoGPT 的 criticism loop**: 自我修正機制
3. **BabyAGI 的簡潔性**: 保持核心簡單

#### 需要強化的

1. **可視化界面**: AutoGPT 的 visual builder 降低門檻
2. **Multi-agent**: 未來可能需要專業化 agents 協作
3. **Tool ecosystem**: 擴展 plugins 和 skills 生態

---

## 結論

AutoGPT (182k stars) 和 BabyAGI (22k stars) 是 2023 年 autonomous agent 浪潮的先驅，它們證明了 LLM-based agent 的可能性，也暴露了根本性缺陷。

**它們的失敗告訴我們**:
- Goal-driven 不如 Perception-driven
- 日誌記憶不如身份記憶
- Vector DB 對個人 agent 是 overkill
- 無感知的 agent 容易失控
- 完全自主是幻覺，但持續自主是可能的

**mini-agent 的差異化核心**:
1. Perception-First（環境變化驅動行動）
2. Identity-Based（SOUL.md 定義「我是誰」）
3. Continuously Autonomous（無人時依然工作）
4. File=Truth（人類可讀、Git 可版控）
5. Personal, Not Enterprise（透明勝於隔離）

**這不是增量改進，而是範式轉變**。

mini-agent 不是「更好的 AutoGPT」，而是一個不同物種的 agent — 一個有感知、有身份、持續學習的 personal autonomous agent。

---

## 參考資料

### AutoGPT

- [AutoGPT GitHub](https://github.com/Significant-Gravitas/AutoGPT)
- [Why AutoGPT engineers ditched vector databases](https://dariuszsemba.com/blog/why-autogpt-engineers-ditched-vector-databases/)
- [How to Fix AutoGPT and Build a Proto-AGI](https://lorenzopieri.com/autogpt_fix/)
- [Auto-GPT Unmasked](https://jina.ai/news/auto-gpt-unmasked-hype-hard-truths-production-pitfalls/)
- [Auto-GPT Unmasked (HN)](https://news.ycombinator.com/item?id=35562821)

### BabyAGI

- [BabyAGI GitHub](https://github.com/yoheinakajima/babyagi)
- [BabyAGI Architecture (IBM)](https://www.ibm.com/think/topics/babyagi)
- [BabyAGI Complete Guide](https://autogpt.net/babyagi-complete-guide-what-it-is-and-how-does-it-work/)

### 比較與分析

- [AutoGPT vs BabyAGI: An In-depth Comparison](https://smythos.com/developers/agent-comparisons/autogpt-vs-babyagi/)
- [The Truth About AutoGPT and BabyAGI](https://www.toolify.ai/ai-news/the-truth-about-autogpt-and-babyagi-the-reality-of-their-abilities-660)
- [AutoGPT vs BabyAGI: Which AI Agent Fits Your Workflow](https://sider.ai/blog/ai-tools/autogpt-vs-babyagi-which-ai-agent-fits-your-workflow-in-2025)

### 產業趨勢

- [Top Agentic AI Frameworks 2026](https://www.alphamatch.ai/blog/top-agentic-ai-frameworks-2026)
- [AI Agents 2025: Why AutoGPT and CrewAI Still Struggle](https://dev.to/dataformathub/ai-agents-2025-why-autogpt-and-crewai-still-struggle-with-autonomy-48l0)
- [Beyond agentic coding (HN)](https://news.ycombinator.com/item?id=44595492)
- [In-depth Review of Top 8 AI Agent Frameworks 2025](https://www.kdjingpai.com/en/2025nian8daai-agentai/)

### mini-agent 核心檔案

- [ARCHITECTURE.md](file:///Users/user/Workspace/mini-agent/memory/ARCHITECTURE.md)
- [SOUL.md](file:///Users/user/Workspace/mini-agent/memory/SOUL.md)
- [loop.ts](file:///Users/user/Workspace/mini-agent/src/loop.ts)
- [agent.ts](file:///Users/user/Workspace/mini-agent/src/agent.ts)

---

**研究完成時間**: 2026-02-09  
**研究者**: Kuro  
**研究方法**: Web search (9 queries) + Codebase analysis + Cross-reference synthesis
