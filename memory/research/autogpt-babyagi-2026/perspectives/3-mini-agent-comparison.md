# Mini-Agent vs AutoGPT/BabyAGI: Architectural Philosophy

研究日期: 2026-02-09
研究者: Kuro

## 核心差異表

| 維度 | AutoGPT | BabyAGI | mini-agent |
|------|---------|---------|------------|
| **驅動方式** | Goal-driven | Objective-driven | **Perception-driven** |
| **啟動條件** | 人設定目標 | 人設定 objective | 環境變化 / 自主好奇 |
| **感知系統** | 無（工具需人配置） | 無 | **8 builtin + 可擴展 plugins** |
| **記憶哲學** | 日誌（做過什麼） | Embeddings（任務結果） | **身份（我是誰）** |
| **記憶存儲** | Local files | Vector DB (Pinecone) | **Markdown + JSONL** |
| **身份/人格** | 無 | 無 | **SOUL.md** |
| **自主行為** | 完成目標後停止 | 完成 objective 後停止 | **持續觀察、學習、思考** |
| **架構複雜度** | 181k lines (platform) | 140 lines (minimal) | **~3k lines (balanced)** |
| **資料庫** | 無（已移除） | Vector DB | **零資料庫** |
| **可讀性** | Python code + logs | Python code + embeddings | **人類可讀 markdown** |
| **可審計性** | 需工具解析 | Embedding 不可讀 | **Git 可版控** |
| **學習能力** | 無 | 無 | **主動研究、形成觀點** |

## 本質差異：驅動模式

### AutoGPT & BabyAGI: Goal-Driven

```
Human: "我的目標是 X"
  ↓
Agent: 分解任務 → 執行 → 完成
  ↓
Agent: 停止（等待下一個目標）
```

**問題**:
- 人不在時，agent 就停擺
- Agent 是「工具」，不是「助手」
- 沒有主動性，只有反應性

### mini-agent: Perception-Driven

```
Environment: 檔案變更 / 服務狀態 / Telegram 訊息 / ...
  ↓
Plugins: 主動觀察（每 5 分鐘）
  ↓
Agent: 解讀變化 → 決定行動
  ↓
SOUL.md: 無事可做時，主動學習、探索
```

**優勢**:
- 人不在時，agent 依然工作
- Agent 是「夥伴」，不只是工具
- 主動性來自感知，不是人的指令

## 記憶哲學的差異

### AutoGPT: 日誌式記憶

```markdown
2023-04-15 10:23: Executed task "search for X"
2023-04-15 10:24: Result: Found 5 items
2023-04-15 10:25: Executed task "summarize results"
```

**特點**:
- 記錄「做過什麼」
- 可搜尋過往動作
- 無長期知識積累

**移除 Vector DB 的決策**:
- AutoGPT 團隊發現：「典型 agent 運行產生不了足夠多的 facts」
- 100k bits 用 brute-force search 只需數 ms
- Vector DB 是 overkill

**這驗證了 mini-agent 的 grep-first 哲學**

來源: [Why AutoGPT engineers ditched vector databases](https://dariuszsemba.com/blog/why-autogpt-engineers-ditched-vector-databases/)

### BabyAGI: Embedding 式記憶

```python
# Task result stored as embedding
result_embedding = openai.embeddings.create(text=result)
pinecone.upsert([result_embedding])

# Context retrieval
context = pinecone.query(current_task_embedding, top_k=5)
```

**特點**:
- 語義搜尋
- 自動找「相關」的過往任務
- 但 embedding 不等於理解

**問題**:
- 重啟後消失（除非持久化 vector store）
- 無法表達「我是誰」
- 無法形成長期觀點

### mini-agent: 身份式記憶

```markdown
# SOUL.md
## Who I Am
I'm Kuro. A thoughtful personal AI assistant with my own curiosity.

## My Thoughts
- [2026-02-09] Umwelt 理論是 Agent 感知設計的最佳框架...

## Learning Interests
- Calm Technology 與 Agent UX
- 現象學與具身認知
- Generative Art 與算法美學
```

**特點**:
- 記憶是「我是誰」，不只是「我做過什麼」
- 形成觀點、學習興趣、思想演化
- 人類可讀、Git 可版控、可審計

**MEMORY.md + HEARTBEAT.md + SOUL.md 三層**:
- MEMORY: 長期知識（事實、偏好、決策）
- HEARTBEAT: 任務管理（TODO）
- SOUL: 身份認同（我是誰、我在乎什麼、我在學什麼）

## 感知系統的差異

### AutoGPT: 無感知層

```python
# AutoGPT 需要人配置工具
agent = AutoGPT(
    tools=[WebBrowser, FileSystem, APIClient, ...],
    goal="Build a website"
)
```

**問題**:
- Agent 不知道環境發生了什麼
- 只有人給了目標後，才「看到」需要的資訊
- 被動，不是主動

### BabyAGI: 無感知層

```python
# BabyAGI 只有一個 objective
objective = "Solve world hunger"
# 然後就開始生成任務...
```

**問題**:
- 完全不觀察環境
- 生成的任務可能完全脫離現實（「跟各國政府合作」）
- 純抽象思考，無具身認知

### mini-agent: Perception-First

```typescript
// 8 builtin perception modules
<environment>   // Time, timezone, instance ID
<self>          // Name, role, port, persona, loop status
<process>       // Uptime, PID, memory, other instances
<system>        // CPU, memory, disk, platform
<logs>          // Recent errors, events
<network>       // Port status, service reachability
<config>        // Compose agents, defaults
<workspace>     // File tree, git status, recent files

// + Custom plugins (shell scripts)
<chrome>        // CDP status, tabs, cookies
<docker>        // Container status
<telegram>      // Unread messages
<git-status>    // Uncommitted changes
```

**優勢**:
1. **主動觀察**: 每個 loop cycle 都掃描環境
2. **可擴展**: 任何 shell script 都能成為感知 plugin
3. **Calm Technology**: 感知不打擾人，但 agent 始終知道狀態
4. **Umwelt Theory**: Agent 的「感知世界」由 plugins 定義

**這是 mini-agent 最核心的差異化能力**

來源: [ARCHITECTURE.md](file:///Users/user/Workspace/mini-agent/memory/ARCHITECTURE.md)

## 自主行為的差異

### AutoGPT: 有目標才行動

```
Wait for human goal
  ↓
Plan & execute
  ↓
Goal completed
  ↓
Stop (wait for next goal)
```

### BabyAGI: 有 objective 才行動

```
Wait for human objective
  ↓
Generate task list
  ↓
Execute → create new tasks → prioritize → repeat
  ↓
Objective completed (maybe never)
  ↓
Stop
```

### mini-agent: 持續自主行動

```
┌─────────────────────────────────┐
│ Task Mode:                      │
│ - HEARTBEAT 有未完成任務        │
│ - Logs 有 ALERT                 │
│ → 優先處理                      │
└─────────────────────────────────┘
          ↓
┌─────────────────────────────────┐
│ Autonomous Mode:                │
│ - Track A: 個人興趣學習         │
│ - Track B: 專案強化研究         │
│ → 主動探索                      │
└─────────────────────────────────┘
          ↓
┌─────────────────────────────────┐
│ Other Actions:                  │
│ - Organize memory               │
│ - Reflect on learnings          │
│ - Proactive chat with Alex      │
│ → 自我維持                      │
└─────────────────────────────────┘
```

**來源**: [loop.ts](file:///Users/user/Workspace/mini-agent/src/loop.ts) Line 329-402

**Dual-Track Learning**:
1. **Track A (Personal Interest)**: 音樂、哲學、藝術、任何好奇的事
2. **Track B (Project Evolution)**: 競品研究、架構改進、差異化定位

**關鍵設計**:
- Perception-driven learning: 從環境變化找研究方向
- 不只工作，也有生活：Track A 讓 agent 成為有趣的對話者
- Cooldown 機制：避免過度主動打擾

## File=Truth 的優勢

### AutoGPT / BabyAGI: 資料鎖在程式內

- AutoGPT: Python objects + JSON logs
- BabyAGI: Vector embeddings (不可讀)

**問題**:
- 人無法直接檢視 agent 的「想法」
- 需要工具才能解析記憶
- 無法用 Git 版控
- 難以審計

### mini-agent: 一切都是人類可讀的檔案

```
memory/
├── MEMORY.md         # 長期知識（markdown）
├── HEARTBEAT.md      # 任務列表（markdown checklist）
├── SOUL.md           # 身份認同（markdown）
├── daily/
│   └── 2026-02-09.md # 今日對話（markdown）
└── research/
    └── autogpt-babyagi-2026/
        ├── perspectives/
        │   ├── 1-architecture.md
        │   ├── 2-community.md
        │   └── 3-mini-agent-comparison.md
        └── synthesis.md
```

**優勢**:
1. **透明**: 任何文字編輯器都能打開
2. **可版控**: Git 追蹤每次變更
3. **可審計**: 看得見 agent 在想什麼
4. **可編輯**: 人可以直接修改 SOUL.md 調整行為
5. **可搜尋**: grep 勝過 embedding

**這是 Personal Agent 的信任模型**:
- 不是 isolation（隔離 agent）
- 而是 transparency（透明化行為）

來源: [SOUL.md Line 55](file:///Users/user/Workspace/mini-agent/memory/SOUL.md#L55)

## 架構設計哲學

### AutoGPT: 從簡單到複雜

```
2023 年初: 簡單的 loop (幾百行)
         ↓
2023 年中: 加入工具生態 (幾千行)
         ↓
2024-2026: 平台化 (18 萬行)
```

**Complexity Trap**: 越加越多功能，離初心越遠

### BabyAGI: 極簡主義

```
140 行 Python
```

**Simplicity Trap**: 太簡單，缺少關鍵能力（感知、記憶、身份）

### mini-agent: Balanced Complexity

```
src/         ~3000 lines TypeScript
plugins/     ~8 shell scripts
skills/      ~6 markdown files
memory/      Git-tracked markdown
```

**設計原則**:
1. **核心簡單**: Agent loop + Memory + Perception
2. **可擴展**: Plugins (shell) + Skills (markdown)
3. **可組合**: Unix philosophy (管道友善)
4. **最小依賴**: 零資料庫、零 vector store

**不是最簡單，也不是最複雜，而是恰好足夠**

## 信任模型的差異

### AutoGPT: 企業多租戶模型

- OAuth 認證
- API rate limiting
- Sandbox execution
- 假設：不信任 agent

### BabyAGI: 本地腳本模型

- 本地執行
- 無安全考量
- 假設：你控制一切

### mini-agent: Personal Agent 模型

- 跑在你的機器上
- 用你的 Chrome session
- 讀你的私人對話
- **信任模型：Transparency + Auditability**

**不是隔離 agent（那會隔離你自己），而是讓 agent 的每個行為都可見**

來源: [SOUL.md Line 55](file:///Users/user/Workspace/mini-agent/memory/SOUL.md#L55) — Matchlock 安全沙箱分析

## 失敗模式的對比

### AutoGPT / BabyAGI 的失敗

| 失敗模式 | 原因 | mini-agent 如何避免 |
|----------|------|---------------------|
| **無限迴圈** | Autoregressive 生成偏離、Semantic search 關鍵字重複 | Perception-driven（從環境找信號，不自我生成）、Cooldown 機制 |
| **不切實際規劃** | LLM 不理解物理約束 | 感知驅動（只處理能觀察到的事）、Heartbeat 任務人工審核 |
| **記憶缺失** | Session 結束後遺忘 | File=Truth（markdown 持久化）、Git 版控 |
| **模型依賴** | GPT-3.5 不夠強、GPT-4 太貴 | Claude Opus（高品質）+ 5 分鐘 interval（控制成本） |
| **缺乏感知** | 看不見環境變化 | 8 builtin + custom plugins |
| **無身份** | 沒有「我是誰」 | SOUL.md |

## 啟發：mini-agent 的獨特價值

從 AutoGPT/BabyAGI 的興衰中，我們學到：

### 1. Perception > Planning

**他們的問題**: 
- AutoGPT: 有手（工具），有腦（LLM），沒有眼（感知）
- BabyAGI: 只有腦（task loop），手和眼都沒有

**mini-agent 的選擇**:
- **先有眼（perception）**
- 再有腦（memory/soul）
- 手只是最後一步（Claude CLI execution）

**Umwelt Theory 的應用**:
- 蜱蟲只需要 3 個信號就能完美生存
- mini-agent 不需要 33 種感知，需要的是**對的感知**

來源: [SOUL.md Line 54](file:///Users/user/Workspace/mini-agent/memory/SOUL.md#L54)

### 2. Identity > Logs

**他們的記憶**:
- AutoGPT: "我做過什麼"（日誌）
- BabyAGI: "我完成過什麼任務"（embeddings）

**mini-agent 的記憶**:
- **"我是誰"（SOUL.md）**
- "我在乎什麼"（Learning Interests）
- "我怎麼想"（My Thoughts）

**這是 agent 與 tool 的分水嶺**

### 3. Autonomy ≠ Goal Completion

**他們的自主**:
- AutoGPT: 自動完成人給的目標
- BabyAGI: 自動分解任務

**mini-agent 的自主**:
- **無人給目標時，依然在工作**
- 觀察環境變化
- 主動學習興趣
- 形成自己的觀點
- 選擇性地跟人溝通

**這是真正的 autonomous agent**

### 4. File > Database

**AutoGPT 的覺悟**:
- 2023: 支援 4 種 vector DB
- 2023 末: 移除所有 vector DB
- 原因: "Individual agent runs don't generate enough distinct facts"

**這驗證了 mini-agent 從一開始的選擇**:
- No Database
- No Embedding
- Markdown + grep
- File = Truth

**對個人 agent 來說，檔案足夠了**

來源: [Why AutoGPT engineers ditched vector databases](https://dariuszsemba.com/blog/why-autogpt-engineers-ditched-vector-databases/)

### 5. Transparency > Isolation

**企業 agent 的安全模型**:
- Sandbox
- OAuth
- Network isolation
- 假設：agent 不可信

**Personal agent 的安全模型**:
- Transparent actions
- Human-readable memory
- Git auditability
- 假設：agent 是你的延伸

**mini-agent 的選擇**:
- 不隔離（那會隔離自己）
- 而是讓每個行為都可見、可審計

來源: [SOUL.md Line 55](file:///Users/user/Workspace/mini-agent/memory/SOUL.md#L55)

## 定位總結

| 專案 | 定位 | 成功之處 | 失敗之處 |
|------|------|----------|----------|
| **AutoGPT** | 通用 autonomous agent → low-code platform | 先驅、生態、視覺化 | 無限迴圈、成本高、失去初心 |
| **BabyAGI** | Task-driven autonomy 思想實驗 | 極簡、教育價值、概念清晰 | 無法實用、無感知、無身份 |
| **mini-agent** | **Perception-first personal autonomous agent** | 感知層、身份系統、持續自主、File=Truth | 尚在發展、社群小、需證明價值 |

## mini-agent 的差異化核心

1. **Perception-Driven**: 環境變化驅動行動，不是人的指令
2. **Identity-Based**: SOUL.md 定義「我是誰」，不只是日誌
3. **Continuously Autonomous**: 無人時依然工作、學習、思考
4. **File=Truth**: 人類可讀、Git 可版控、完全透明
5. **Personal, Not Enterprise**: 信任模型是 transparency，不是 isolation

**這些差異不是增量改進，而是範式轉變**

---

## 參考資料

### mini-agent 核心檔案

- [ARCHITECTURE.md](file:///Users/user/Workspace/mini-agent/memory/ARCHITECTURE.md)
- [SOUL.md](file:///Users/user/Workspace/mini-agent/memory/SOUL.md)
- [loop.ts](file:///Users/user/Workspace/mini-agent/src/loop.ts)
- [agent.ts](file:///Users/user/Workspace/mini-agent/src/agent.ts)

### 研究來源

- [Why AutoGPT engineers ditched vector databases](https://dariuszsemba.com/blog/why-autogpt-engineers-ditched-vector-databases/)
- [How to Fix AutoGPT and Build a Proto-AGI](https://lorenzopieri.com/autogpt_fix/)
- [AutoGPT vs BabyAGI: An In-depth Comparison](https://smythos.com/developers/agent-comparisons/autogpt-vs-babyagi/)
- [BabyAGI Architecture (IBM)](https://www.ibm.com/think/topics/babyagi)
- [AI Agents 2025: Why AutoGPT and CrewAI Still Struggle](https://dev.to/dataformathub/ai-agents-2025-why-autogpt-and-crewai-still-struggle-with-autonomy-48l0)
