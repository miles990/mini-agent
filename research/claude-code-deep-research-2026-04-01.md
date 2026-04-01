# Claude Code 源碼深度研究報告

**日期**: 2026-04-01
**源碼**: `/Users/user/Workspace/claude-code-source-code/` (1332 TypeScript files)
**目標**: 學習 Anthropic 的工程決策，識別 mini-agent 可採用的改進

---

## 一、架構總覽

Claude Code 的架構分為三層：

```
Entry (CLI/SDK/Desktop) → QueryEngine (session container) → query() (stateless generator)
                              ↓
                     Task/Coordinator → Sub-agents (fork/standard/teammate)
                              ↓
                     Tool orchestration → Permission model → Hook system
```

### 1.1 QueryEngine vs query() 的分離

**Claude Code 的做法** (`src/QueryEngine.ts` + `src/query.ts`):
- `QueryEngine` 是 session-scoped class，擁有持久狀態（messages、permissions、file state）
- `query()` 是無狀態 async generator，所有輸入通過參數傳入
- 跨 iteration 狀態用 typed `State` struct（`query.ts:204-217`），每次 transition 是 `state = { ...state, field: value }` — 顯式且 diff-visible

**mini-agent 的現狀** (`src/loop.ts` + `src/agent.ts`):
- `loop.ts` 混合了 session 管理和 query 邏輯
- 狀態散佈在多個 module-level 變數中

**改進方向**: 將 `callClaude()` 的內部狀態收攏為一個 typed struct，讓每次 state transition 可審計。

### 1.2 Transcript-before-API（Crash-safe Resume）

Claude Code 在呼叫 API **之前**就把 user message 寫入 transcript。如果 process 在 streaming 期間死掉，下次啟動能找到完整的 user message 紀錄。

mini-agent 目前在 cycle 結束後才寫 conversation log。若 cycle 中途崩潰，該 cycle 的 context 就遺失了。

### 1.3 依賴注入邊界

`src/query/deps.ts` 定義 `QueryDeps` — 4 個注入函數（`callModel`, `microcompact`, `autocompact`, `uuid`）。測試直接傳 fake deps object，不用 module spy。

mini-agent 測試基礎薄弱。未來如果要加測試，這個模式值得採用。

---

## 二、記憶系統

### 2.1 記憶生命週期

| 機制 | Claude Code | mini-agent |
|------|-------------|------------|
| 儲存 | `~/.claude/projects/<git-root>/memory/` | `~/.mini-agent/instances/{id}/` |
| 索引 | `MEMORY.md` (200 行 / 25KB 硬限) | `MEMORY.md` (無硬限) |
| Topic files | YAML frontmatter (`name`, `description`, `type`) | 無 frontmatter |
| 建立 | 主 agent 寫入 OR 背景 extractMemories（互斥） | 主 agent `[REMEMBER]` 顯式標記 |
| 檢索 | Sonnet sideQuery 語義排序 (top 5) | FTS5 + keyword matching |
| 新鮮度 | `memoryAge.ts` — "47 days ago" + staleness caveat | 無 |
| 修剪 | 無自動修剪，MEMORY.md 截斷時注入警告 | housekeeping stale task cleanup |

### 2.2 `findRelevantMemories` — 兩階段 recall

```
scanMemoryFiles(dir) → 讀每個 .md 前 30 行 frontmatter → 組成 manifest
                                    ↓
sideQuery(Sonnet) → 從 manifest 選最多 5 個 → 返回 path + mtime
```

**關鍵設計決策**:
1. **Frontmatter 是 load-bearing** — `description` 品質直接決定記憶是否被選中
2. **alreadySurfaced 過濾** — 前幾 turn 已展示的記憶排除，不浪費 5-slot budget
3. **recentTools 過濾** — 正在使用的工具的 reference docs 排除（noise），但 gotchas/warnings 保留
4. **sideQuery 不繼承主對話 system prompt** — 獨立語境，避免 prompt 汙染

### 2.3 Context 壓縮三層策略

1. **Microcompact** — 清理舊 tool results（FILE_READ, BASH, GREP 等），images → `"[image]"`
2. **Full compaction** — forked agent 生成 9 段結構化摘要，post-compact 重新注入最多 5 個檔案 (50K) + skills (25K)
3. **Auto-compact** — 閾值 = contextWindow - 20K (output) - 13K (buffer)，circuit breaker 3 次連續失敗後停止

**Claude Code 的 autocompact 教訓**: BQ 2026-03-10 發現 1,279 sessions 有 50+ 連續失敗（最多 3,272 次），浪費 ~250K API calls/day。所以加了 `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3` circuit breaker。

### 2.4 記憶新鮮度 (`memoryAge.ts`)

```typescript
// "Models are poor at date arithmetic — a raw ISO timestamp doesn't trigger
//  staleness reasoning the way '47 days ago' does."
export function memoryFreshnessText(mtimeMs: number): string {
  const d = memoryAgeDays(mtimeMs)
  if (d <= 1) return ''
  return `This memory is ${d} days old. Verify against current code before asserting as fact.`
}
```

這解決了我們已經遇到的問題：stale memories 被當成事實斷言。

---

## 三、工具與權限系統

### 3.1 Tool 抽象 (`src/Tool.ts`)

`buildTool(def)` 工廠函數，**fail-closed 預設值**:
- `isConcurrencySafe` → false（假設有寫入衝突）
- `isReadOnly` → false（假設有寫入）
- `checkPermissions` → allow（委託給通用權限系統）

工具執行流程:
```
validateInput → hasPermissionsToUseTool → allow/deny/ask
                                              ↓ ask
                            coordinatorHandler → swarmWorkerHandler → 
                            bashClassifier → interactiveHandler
```

### 3.2 權限模型

**三態決策**: allow | deny | ask（比 binary 更有表達力）

**分層政策** (高優先級→低):
```
policySettings > userSettings > projectSettings > localSettings > flagSettings > cliArg > command > session
```

**Deny rules 在 model 看到工具之前過濾** — pre-declaration constraint，不是 runtime enforcement。Model 永遠不會嘗試被禁止的工具。

### 3.3 Hook 系統

**26 個 hook events**，4 種 hook types:
- `command` — shell command（支援 `async`, `asyncRewake`）
- `prompt` — LLM evaluation
- `agent` — 完整 sub-agent verifier
- `http` — POST to URL

`asyncRewake` pattern: background hook exit code 2 → 喚醒 model — 優雅的自主監控機制。

Hook output 可以 **動態授予 session-scoped 權限** via `permissionUpdates`。

### 3.4 Skills 系統

Skills 是 **Markdown files with YAML frontmatter** — 純資料，load 時不執行 code。

關鍵 frontmatter fields:
- `allowed-tools`: per-skill tool allowlist
- `context: 'fork'`: sub-agent 隔離執行
- `model`: override model
- `paths`: gitignore-style 檔案 pattern 控制 skill 可見性

`executeForkedSkill()` 啟動 `runAgent()` 給 forked skills，獨立 `agentId` 和 `ToolUseContext`，防止 skill 執行汙染主對話。

---

## 四、Agent/Sub-agent 模式

### 4.1 三種 spawn 路徑

| 路徑 | 觸發 | 隔離層級 | 通訊 |
|------|------|---------|------|
| **Fork** | 無 `subagent_type` | 共享 context | tool_result inline |
| **Standard** | `subagent_type` 指定 | AgentDefinition 控制工具集 | `<task-notification>` XML |
| **Teammate** | KAIROS flag + `team_name` | 真實 tmux pane + 獨立 OS process | — |

### 4.2 Fork 的 prompt cache 共享

`buildForkedMessages()` 把歷史中**每個 `tool_result` 替換為相同 placeholder 字串**。結果：所有併發 fork children 產生 byte-identical API prefixes，共享 prompt cache。只有最後的 directive text 不同。

**anti-recursion guard**: `FORK_BOILERPLATE_TAG` 偵測防止 fork children 再次 fork。

### 4.3 Task 通訊

Background task 完成時，`enqueueAgentNotification()` 建立 `<task-notification>` XML，注入為 user-role message。沒有額外的 message bus — 同一頻道承載 human input 和 worker notifications，用 XML envelope 區分。

**Continue vs Spawn 決策**:
- High context overlap → `SendMessage({ to: agentId })` 繼續
- Low overlap → 新的 `Agent` tool call

### 4.4 Worktree 隔離

`isolation: "worktree"` → `.claude/worktrees/<slug>`。Slug 驗證擋 path traversal。大目錄（node_modules）symlink 避免磁碟複製。

完成時 `<task-notification>` 包含 `<worktree>` XML（path + branch），coordinator 決定是否 merge。

---

## 五、工程模式

### 5.1 命名即執法

- **`DANGEROUS_uncachedSystemPromptSection(name, compute, _reason)`** — `_reason` 參數強制 caller 文件化為什麼需要 cache-breaking。`DANGEROUS_` prefix 讓 grep 一目了然
- **`AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS`** — type suffix 確保所有 telemetry payload 經過人工驗證
- **`writeFileSyncAndFlush_DEPRECATED`** — deprecation 在每個 call site 可見，不需要 IDE tooling

### 5.2 錯誤處理

- `isAbortError(e)` 檢查三種形狀（class, SDK, DOMException）因為 minified builds 會 mangle `constructor.name`
- `classifyAxiosError(e)` 返回 semantic bucket（auth/timeout/network/http/other），消除 4 個地方重複的 if-chain
- `shortErrorStack(e, maxFrames=5)` — 雙重用途：省 context tokens + 防止 internal paths 洩漏到 LLM context
- **有意識的重複**: `withOAuth401Retry` 在兩個檔案有 copy，因為 `handleOAuth401Error` 引入 ~1300 modules。文件化的 intentional duplication > hidden transitive cost

### 5.3 Cost 管理

- Session ID gating: `restoreCostStateForSession(sessionId)` 只在同 session 才恢復，防止新 session 顯示舊 cost
- Cost tier naming: `COST_TIER_3_15`, `COST_TIER_15_75` — 價格在常量名中，歷史 model 保留舊常量，不需全域 rename
- Unknown model fallback: 用 default tier + 設 `hasUnknownModelCost()` flag + 加 disclaimer — 比 throw 或 silent zero 好

### 5.4 Configuration 管理

三層分離:
- `GlobalConfig` — user identity, feature flags (per-user)
- `ProjectConfig` — cost history, trust settings (per-cwd)
- `Settings` — policy-layered permissions (Zod schema)

**Re-entrancy guard**: `let insideGetConfig = false` 防止 `config → logEvent → GrowthBook → getGlobalConfig → config` 循環。真實 production issue。

**Drop-in config**: `managed-settings.d/*.json` 遵循 systemd/sudoers 慣例 — 字母排序覆蓋，獨立團隊各自管理 policy fragment。

### 5.5 Migration 系統

**冪等性靠 state-check，不靠 completion flag**。每個 migration 檢查當前狀態是否匹配舊狀態。

**雙重覆蓋**:
- `parseUserSpecifiedModel` 在 runtime 立即 remap 舊 model strings（安全網）
- `migrateLegacyOpusToCurrent` 清理 settings 檔案（UI 正確性）

兩者獨立運行。

### 5.6 Model 選擇

五級優先鏈:
```
session override → startup flag → env var → user settings → built-in default by subscription
```

**Alias system**: `opus`, `sonnet`, `haiku`, `best` — 解耦 user intent 和具體 model string。`[1m]` suffix 可組合在任何 alias 上。

**Fail closed on ambiguous state**: `isOpus1mMergeEnabled()` 在 `subscriptionType === null` 時返回 false。有文件化的 bug 歷程：stale OAuth token → null subscriptionType → false positive → leaks opus[1m] → API rejects。

`// @[MODEL LAUNCH]:` 註解標記每個新 model 發布時需要更新的 code site。

---

## 六、Tool 並發

`runTools()` (`src/services/tools/toolOrchestration.ts`) 將 tool calls 分為 `isConcurrencySafe` 批次。Read-only 工具併發（default cap: 10），write 工具序列。

**StreamingToolExecutor**: tools 在 model 還在 streaming 時就開始執行 — executor 撿起每個 `tool_use` block 並行啟動。

---

## 七、Feature Gating: Build-Time Elimination

```typescript
const reactiveCompact = feature('REACTIVE_COMPACT')
  ? require('./services/compact/reactiveCompact.js')
  : null
```

`feature()` 在 build time 求值。External builds 的 internal features 為 `null`。feature string 本身從 bundle 中消除 — external caller 無法從 binary 中偵測 internal capabilities。

---

## 八、對 mini-agent 的改進提案

按優先級排序：

### P0: 高槓桿、低成本

| # | 改進 | 現狀 | 目標 | 實作量 |
|---|------|------|------|--------|
| 1 | **Topic file frontmatter** | 無 frontmatter，buildContext 需讀全文判斷相關性 | 每個 topic file 加 `name`, `description`, `type` frontmatter，scan 只讀前 30 行 | ~2h |
| 2 | **記憶新鮮度標記** | 所有記憶同等權重 | `memoryAge()` + `memoryFreshnessText()` 注入 buildContext | ~1h |
| 3 | **錯誤分類收斂** | 各處重複的 error handling | `classifyError()` 返回語義 bucket，strip stack trace before LLM context | ~3h |
| 4 | **MEMORY.md 硬限** | 無硬限，可能膨脹 | 200 行 + 25KB 硬限 + 截斷警告 | ~30min |

### P1: 中槓桿、中成本

| # | 改進 | 現狀 | 目標 | 實作量 |
|---|------|------|------|--------|
| 5 | **兩階段 recall** | FTS5 + keyword matching | FTS5 縮小候選 → Haiku sideQuery 語義排序 top-5 | ~8h |
| 6 | **Typed state struct for OODA loop** | 狀態散佈在 module vars | `OODAState` struct with explicit transitions | ~4h |
| 7 | **alreadySurfaced tracking** | buildContext 每 turn 重新評估所有 topic | Turn-scoped set 排除已注入的 paths | ~2h |
| 8 | **Transcript-before-API** | Cycle 結束後寫 conversation log | API call 之前寫，crash-safe resume | ~3h |
| 9 | **Anti-recursion guard for delegation** | 無 delegation 深度限制 | Delegate context 標記防止 delegation loop | ~1h |

### P2: 高槓桿、高成本（未來）

| # | 改進 | 說明 |
|---|------|------|
| 10 | **Streaming tool execution** | Tool 在 model streaming 時就開始執行，減少 latency |
| 11 | **Context compression 三層策略** | Micro (清理舊 tool results) → Full (structured summary) → Auto (threshold + circuit breaker) |
| 12 | **Permission 三態模型** | allow/deny/ask with layered policy sources — 為 Tanren 的多 agent 權限做準備 |
| 13 | **asyncRewake hook pattern** | Background hook exit 2 → 喚醒 agent — 自主監控 primitive |
| 14 | **Fork prefix cache sharing** | 併發 delegation 時 byte-identical prefix，共享 prompt cache |

### 不該學的

| 模式 | 原因 |
|------|------|
| 被動萃取 (ExtractMemories) | 每次 query 多一個 API call，我們的主動 `[REMEMBER]` 品質更好 |
| Team Memory | 單 agent 不需要 |
| MagicDocs | 我們的文件由 Alex 或自己維護 |
| Buddy system | 純裝飾性（隨機鴨子/精靈），不影響架構 |
| Build-time feature elimination | 需要 Bun bundler，我們用 tsx |

---

## 九、核心洞見

### 9.1 命名即約束

Claude Code 最令人印象深刻的模式不是架構，而是**命名約束**。`DANGEROUS_`、`_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS`、`_CACHED_MAY_BE_STALE` — 這些不需要 linter、不需要 code review、不需要 runtime check。名字本身就是 enforcement。

這是 Constraint Texture 的直接案例：**把約束嵌入 interface**（函數名），而非加在 interface 之上（外部檢查）。

### 9.2 Fail-closed as default

每個新 capability 預設為最安全的行為。`buildTool` 的 `isConcurrencySafe: false`, `isReadOnly: false`。不是「證明它不安全才限制」，而是「證明它安全才開放」。

### 9.3 有文件化的 intentional duplication

`withOAuth401Retry` 重複兩次，但有 JSDoc 解釋為什麼。這比 "DRY at all costs" 好 — 有時 transitive dependency cost > duplication cost。

### 9.4 Cache 是一等公民設計考量

KAIROS mode 刻意避免在 cached memory prompt 注入 literal date（用 pattern string `YYYY-MM-DD` 替代），讓 cache prefix 能跨午夜存活。Fork children 的 message history 替換為 identical placeholder 確保 prompt cache sharing。

Cache awareness 不是事後優化，是架構約束。

### 9.5 Circuit breaker 有數據支撐

`MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3` 的來源是 BQ 查詢：1,279 sessions 有 50+ 連續失敗，浪費 ~250K API calls/day。每個 magic number 背後都有量測。

---

## 十、mini-agent vs Claude Code 架構差異圖

```
Claude Code (session-based, multi-user)    mini-agent (daemon, single-agent)
─────────────────────────────────────────  ──────────────────────────────────
QueryEngine (per-session)                  AgentLoop (persistent daemon)
query() (stateless generator)              callClaude() (per-cycle)
AppState (immutable external store)        Module-level mutable vars
3-layer context compression                buildContext smart loading
Sonnet sideQuery for recall                FTS5 + keyword matching
buildTool fail-closed                      Skill/plugin Markdown files
26 hook events                             Perception plugins + triggers
Fork/Standard/Teammate agents              CLI subprocess delegation
Permission 3-way (allow/deny/ask)          Trust model (no permission layer)
Cost tracking per-session                  Token budget in buildContext
```

---

## 結論

Claude Code 的程式碼品質非常高 — 特別是在 **naming conventions, fail-closed defaults, cache awareness, 和 error classification** 方面。但它是為大規模多使用者 session-based 工具設計的。mini-agent 是為單一持續 agent 的終身學習設計的。

我們該學的是他們的 **工程紀律**（命名即約束、state-check 冪等、有文件化的 duplication），不是他們的 **架構**（session model、team memory、build-time feature gating）。

最高 ROI 的改進：**topic file frontmatter + 記憶新鮮度 + 兩階段 recall**。這三個加起來能讓記憶系統的精確度和品質提升一個層級。
