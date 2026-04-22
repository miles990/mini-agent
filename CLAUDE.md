# Mini-Agent

極簡個人 AI Agent 框架。檔案導向、零資料庫、可組合。

## 設計理念

**和主流框架的根本差異**：大部分 AI agent 框架是 goal-driven（給目標、執行步驟）。mini-agent 是 **perception-driven**（先看見環境，再決定做什麼）。AutoGPT/BabyAGI 的最大缺陷是「有手沒有眼」— mini-agent 反過來，感知優先於行動。行為模式像黏菌（Physarum polycephalum）：核心感知環境，同時向多個方向伸出觸手探索，找到養分就吸收強化該路徑，沒養分就修剪撤回 — 有機的並行，不是機械的排程。

**和平台型 Agent（OpenClaw 等）的差異**：
- 平台型：Agent 在平台上運行，平台管理身份/記憶/安全
- mini-agent：跑在用戶自己的機器上，嵌入用戶工作環境，SOUL.md 定義自己的身份

**安全模型**：Personal agent 用你的 Chrome session、讀你的對話 — 隔離它等於隔離你自己。mini-agent 選擇 **Transparency > Isolation** — 每個行為都有 audit trail（behavior log + git history + File=Truth）。

## 核心原則

| 原則 | 說明 |
|------|------|
| No Database | Markdown + JSON Lines，人類可讀，Git 可版控（AutoGPT 2023 年底移除全部 vector DB） |
| No Embedding | FTS5 全文搜尋 + grep fallback，個人使用足夠快 |
| File = Truth | 檔案是唯一真相來源 |
| Identity-Driven | SOUL.md 定義 Agent 身份、興趣、觀點（不只是工具，是有成長軌跡的存在） |
| Perception-First | 環境驅動行動，非目標驅動。Plugins 定義 Agent 的 Umwelt（感知世界） |
| Organic Parallelism | 像黏菌（Physarum）一樣有機並行 — 同時多觸手探索，獲取養分後吸收強化，無養分則修剪撤回 |
| Transparency > Isolation | 可讀可審計的信任模型（personal agent 不需要 sandbox） |
| Smart Guidance | 核心行為：始終提供可行動的狀態感知指引 |
| Reactive | 主動偵測環境變化，自動建立任務 |
| Autonomous | 雙軌學習（個人興趣 + 專案強化）+ 學以致用閉環（L1→L2→L3 全自主，安全靠 worktree 隔離 + 驗證閘門 + 自我對抗 review） |
| Positive Feedback Loop | 感知 → 探索 → 獲取養分 → 吸收 → 強化感知 → 修剪低價值路徑 |
| Best Tool for the Job | 有更好的工具就用更好的。記住經驗，不要因為習慣而用次優方案 |
| Balanced Complexity | ~30k 行 TypeScript（AutoGPT 181k 行太膨脹，BabyAGI 140 行太簡）。精煉 > 擴展 — 讓每一行都有理由存在 |

## 三層架構

```
Perception (See)  +  Skills (Know How)  +  Claude CLI (Execute)
```

## 學以致用閉環（Action from Learning）

| Level | 可做的事 | 流程 |
|-------|---------|------|
| **L1: Self-Improve** | 改 skills/*.md、plugins/*.sh、SOUL/MEMORY | Agent 自己做，走 `self-deploy` SOP（驗證→commit→push→確認部署→TG通知） |
| **L2: Feature Implementation** | 涉及 src/*.ts 的改動 | Kuro 自主決定，寫提案記錄，自行實作+部署（2026-02-18 授權） |
| **L3: Architecture** | 大架構改動 | 寫提案 + 自我對抗 review + 實作 + 部署 + TG 通知 Alex（2026-03-06 授權） |

**L3 自主流程**：
1. 寫提案（`memory/proposals/`），標注 Effort: Large，拆解為有序任務
2. Spawn review 觸手，從不同角度挑戰提案（架構合理性、複雜度、可逆性、是否過度工程）
3. Review 通過 → orchestration 執行：
   ```
   forge-lite.sh create <plan-name>        # 建立隔離 worktree
   → 按依賴順序 spawn 觸手在 worktree 中工作
   forge-lite.sh yolo <worktree> "message"  # verify + merge + cleanup
   ```
4. deploy + TG 通知 Alex 結果摘要（做了什麼、為什麼、影響範圍）
5. Alex 事後若不滿意 → git revert 即可回退

提案目錄：`memory/proposals/YYYY-MM-DD-標題.md`

## Key Files

**Core**: `src/cli.ts`, `src/agent.ts`, `src/loop.ts`, `src/dispatcher.ts`, `src/memory.ts`, `src/api.ts`, `src/config.ts`, `src/types.ts`, `src/index.ts`

**Loop 模組化**: `src/inbox-processor.ts`, `src/cycle-tasks.ts`, `src/cycle-state.ts`, `src/prompt-builder.ts`, `src/mushi-client.ts`

**Perception**: `src/perception.ts`, `src/perception-stream.ts`, `src/perception-analyzer.ts`, `src/workspace.ts`, `src/watcher.ts`

**Infrastructure**: `src/event-bus.ts`, `src/event-router.ts`, `src/telegram.ts`, `src/instance.ts`, `src/compose.ts`, `src/cron.ts`, `src/search.ts`, `src/mode.ts`, `src/mcp-server.ts`（config: `mcp-agent.json`）

**Subsystems**: `src/feedback-loops.ts`, `src/achievements.ts`, `src/coach.ts`, `src/delegation.ts`, `src/github.ts`, `src/goal-state.ts`, `src/hesitation.ts`, `src/triage.ts`, `src/verify.ts`

**Shared**: `src/memory-cache.ts`（CQRS read cache + fswatch invalidation）, `src/filelock.ts`（跨進程 file lock）

**Observability**: `src/observability.ts`, `src/logging.ts`, `src/utils.ts`（slog, diagLog, safeExec）

**Scripts**: `scripts/cdp-fetch.mjs`（Browser CDP）, `scripts/forge-lite.sh`, `scripts/room.sh`, `scripts/claude-code-agent-hook.sh`, `scripts/alex-switch.sh`/`alex-done.sh`, `scripts/audio-*.sh`

**Memory**: `memory/SOUL.md`, `memory/ARCHITECTURE.md`, `memory/proposals/`, `memory/topics/*.md`, `memory/conversations/*.jsonl`, `memory/library/`, `memory/discussions/`

**Plugins**: `plugins/github-issues.sh`, `plugins/github-prs.sh`, `plugins/chat-room-inbox.sh`, `plugins/mobile-perception.sh`, `plugins/claude-code-sessions.sh`, `plugins/feedback-status.sh`

**Skills**: `skills/github-ops.md`, `skills/delegation.md`, `skills/friction-reducer.md`, `skills/publish-content.md`, `skills/social-*.md`, `skills/discussion-*.md`, `skills/grow-audience.md`

**Tools**: `tools/kuro-sense/`（Go CLI — detect/apply/serve/pack）

**UI**: `dashboard.html`, `chat-room.html`, `mobile.html`

## Memory Architecture

```
Hot  (In-Memory)  → Last 20 conversations
Warm (Daily File) → daily/YYYY-MM-DD.md
Cold (Long-term)  → MEMORY.md + HEARTBEAT.md + SOUL.md + proposals/
Topic (Scoped)    → topics/*.md (Smart Loading by keyword matching)
Checkpoint        → context-checkpoints/YYYY-MM-DD.jsonl
```

**Memory Scoping**：`[REMEMBER #topic]` 自動寫入 `memory/topics/{topic}.md`，`buildContext` 根據對話關鍵字匹配載入對應 topic。無 `#topic` 的 `[REMEMBER]` 照舊寫 MEMORY.md。

**NEXT.md（執行層待辦）**：`memory/NEXT.md` 管理具體可執行的任務，每個任務有 `Verify:` shell 命令。`buildContext()` 自動載入 Now + Next sections 並執行 Verify 命令，在 context 中標註 ✅ PASSED / ❌ NOT YET。HEARTBEAT = 策略層，NEXT = 執行層。

**Context Checkpoint**：每次 `buildContext()` 自動存 snapshot（timestamp、mode、contextLength、sections），fire-and-forget 不影響效能。

**Auto-Commit（記憶同步）**：每個 loop cycle 結束後，`autoCommitMemoryFiles()` 自動檢查 `memory/` 目錄的未 commit 變更，有變更就 `git add + commit`。Fire-and-forget 不阻塞 cycle。**僅處理 memory 檔案** — `skills/`、`plugins/`（領域知識，跟功能搭配）和 code 變更（`src/`、`scripts/` 等）由 Kuro 自行 commit 並寫有意義的 commit message。

**Auto-Push**：每個 loop cycle 結束後，`autoPushUnpushed()` 自動推送 unpushed commits 到 origin/main。搭配 CI/CD 實現全自動部署。

**ConversationThread Lifecycle**：`resolveStaleConversationThreads()` 每個 cycle 結束後自動清理過期 threads。規則：(1) 所有 thread 類型 24h TTL 自動過期 (2) room threads 在 inbox 清空後立即 resolve。防止 Kuro 對已處理的訊息重複回應。健康狀態可在 `<self-awareness>` 的 Thread Health section 觀察。

Instance path: `~/.mini-agent/instances/{id}/`

## Search System（語義搜尋）

FTS5 全文搜尋取代 grep，支援 BM25 排序和中英文模糊匹配。

**架構**：`src/search.ts` — better-sqlite3 + FTS5 虛擬表（unicode61 tokenizer）

```
searchMemory(query) → FTS5 BM25 搜尋 → 有結果直接回傳
                    → 無結果 → fallback grep（保留原有邏輯）
```

**索引**：
- 自動索引 `topics/*.md` + `MEMORY.md` 中的 entries（bullet 格式）
- DB 路徑：`~/.mini-agent/instances/{id}/memory-index.db`
- `createMemory()` 時自動初始化，若索引為空則自動建立
- `rebuildSearchIndex()` 可全量重建（刪表重建）

**中文支援**：unicode61 tokenizer 對中文做 character-level 分詞，個人筆記規模（<1000 條）足夠好。

## Intelligent Feedback Loops（Phase 2 自我學習）

三個 fire-and-forget 回饋迴路（`src/feedback-loops.ts`），每個 OODA cycle 結束後執行：

| Loop | 功能 | State 檔案 |
|------|------|-----------|
| **A: Error Patterns** | error log 分群，同模式 ≥3 次 → 自動建 HEARTBEAT task | `error-patterns.json` |
| **B: Perception Citations** | 追蹤 action 引用的 `<section>`，每 50 cycle 調整低引用 perception 的 interval | `perception-citations.json` |
| **C: Decision Quality** | 滑動窗口 20 cycle 的 observabilityScore，avg < 3.0 → 注入品質提醒 | `decision-quality.json` |

安全護欄：全部 `.catch(() => {})`、error pattern 不重複建 task、品質警告 24h 冷卻、perception interval 上下限 30s-30min。

## Achievement System（行動力正向強化）

遊戲化里程碑系統（`src/achievements.ts`），獎勵 visible output，不獎勵學習。

**設計原則**（Kuro 提出）：
- 成就不分等級（no Bronze/Silver/Gold）— 每個都是獨特里程碑
- 像 journal entry 不像遊戲分數 — 避免 Goodhart
- 學習不算成就 — 學習本身就是獎勵
- 一旦解鎖永遠是你的 — 不可撤銷

**成就類型**：行動類（First Ship, Momentum, Unstoppable, Builder Week, Back on Track）、創作類（First Words, Storyteller, Shipper）、社群類（Hello World, First Contact）、隱藏類（Night Owl, Self-Aware, Cross-Pollinator）

**機制**：
- 每個 OODA cycle 結束後 fire-and-forget 檢查（經由 `runFeedbackLoops()`）
- 解鎖時 Telegram 通知 + `slog`
- `<achievements>` context section 在 `buildContext()` 中 always load（身份強化）
- 回溯解鎖：首次啟動時自動檢查已有成就
- State: `~/.mini-agent/instances/{id}/achievements.json`

**Schedule Ceiling**：`kuro:schedule` 上限從 4h → 2h（`loop.ts`），程式碼強制。防止用排程逃避行動。

**Output Gate**：連續 3 cycle 無 visible output 時，context 自動注入提醒。visible output = 有 `<kuro:chat>`/`<kuro:done>`/`<kuro:show>`/deploy/publish 等可見行為，純學習/REMEMBER 不算。

## Action Coach（行為教練）

Haiku 驅動的行為教練（`src/coach.ts`），每 3 個 OODA cycle 跑一次，fire-and-forget 不阻塞。

**機制**：
- `runCoachCheck(action, cycleCount)` — 入口，每 3 cycle 觸發
- `gatherCoachInput()` — 收集 behavior log（30 條）+ NEXT.md + HEARTBEAT + delegation status
- `callCoach(input)` — 透過 Claude CLI subprocess（`claude -p --model claude-haiku-4-5-20251001`）呼叫 Haiku，15s timeout
- `buildCoachContext()` — 讀取 `coach-notes.md`，供 `buildContext()` 注入 `<coach>` section，6h TTL 自動過期

**分析重點**：
1. 理論 vs 行動比（太多 REMEMBER/learn，太少 visible output）
2. 說了沒做（NEXT/HEARTBEAT 有任務但 behavior log 無進展）
3. Delegation 結果未 review
4. 停滯任務（>3 天無動作）
5. 正面模式（momentum streak）

**State**：`~/.mini-agent/instances/{id}/coach-state.json`（run history）+ `coach-notes.md`（最新 coaching 提醒）

**Feature toggle**：`coach`（housekeeping group）。calm: off, reserved: on, autonomous: on。

**注意**：使用 Claude CLI subprocess 而非 Anthropic SDK，因為 Kuro 的 launchd 環境不含 `ANTHROPIC_API_KEY`（`execClaude` 有意過濾）。

## Action Feedback Loop Skills（行動正向閉環）

五個 skill 形成完整的社群互動閉環：

```
friction-reducer → publish-content → social-presence → social-monitor → grow-audience → ↑
（降低阻力）     （發佈出去）      （參與互動）      （聽取回饋）     （吸引關注）
```

| Skill | 功能 | JIT Keywords |
|-------|------|-------------|
| `friction-reducer` | Meta-skill：把高阻力的事變成一鍵 SOP，自帶進化機制 | skip, avoid, procrastinate, friction, stuck |
| `publish-content` | 最後一哩路 SOP，5 分鐘內發出去（平台無關） | publish, post, article, tsubuyaki |
| `social-presence` | 社群互動：回應(5min)/分享(10min)/連結(15min) | social, community, follower, engage |
| `social-monitor` | 追蹤社群回應、分類、回覆、記錄 | notification, reply, mention, feedback |
| `grow-audience` | 策略性成長：SEO、跨平台分發、說自己的故事 | audience, growth, marketing, visibility |

所有 skill 在 `act` cycle mode 自動載入。核心理念：**行動 = 學習**，不是為了做而做。

## GitHub Closed-Loop Workflow

GitHub Issues 作為統一追蹤點，機械步驟自動化 + 判斷步驟由 Kuro 決定。

```
入口（proposal/issue/handoff）
  → [github-issues.sh] perception 偵測
  → Kuro triage（依 github-ops.md skill）
  → 實作 → PR（gh pr create --body "Closes #N"）
  → [github-prs.sh] 顯示 CI + review 狀態
  → approved + CI pass → autoMergeApprovedPR() 自動 merge
  → GitHub "Closes #N" 自動 close issue → 閉環
```

**機械自動化**（`src/github.ts`，fire-and-forget，每個 OODA cycle 後執行）：

| 函數 | 功能 |
|------|------|
| `autoCreateIssueFromProposal()` | approved proposal 無 `GitHub-Issue:` → `gh issue create` → 寫回 issue number |
| `autoMergeApprovedPR()` | `reviewDecision=APPROVED` + CI 全 pass + 無 `hold` label → `gh pr merge` |
| `autoTrackNewIssues()` | 新 open issue 不在 `handoffs/active.md` → 自動加一行（`needs-triage`） |

**感知層**（perception plugins，60s file cache，heartbeat category）：
- `<github-issues>` — open issues 分區：Needs Triage / Assigned / Recently Closed
- `<github-prs>` — open PRs + CI/review 狀態，`★ READY-TO-MERGE` 標記，24h merged

**判斷層**（`skills/github-ops.md`）：Triage 決策表（S/M/L）、PR review 準則、mixed review 模型。

**安全護欄**：auto-merge 需雙重條件（approved + CI pass）、`hold` label 可阻止、gh CLI 未安裝時 graceful exit、回退只需刪 `src/github.ts` + loop.ts 移除一行。

## Multi-Lane Architecture

從 OODA-Only 演進為有機並行架構。像黏菌（Physarum）一樣探索環境 — 同時向多個方向伸出觸手，找到養分的路徑強化，沒養分的撤回修剪。一個身份（Kuro）、多條執行 lane。

### 黏菌模型

```
        ┌─ tentacle: research A ──→ 有養分 → 強化（深入學習）
        ├─ tentacle: research B ──→ 沒養分 → 修剪（撤回）
核心 ───├─ tentacle: learn C ─────→ 有養分 → 強化（REMEMBER + 下一波探索）
        ├─ tentacle: code D ──────→ 完成 → 吸收結果
        └─ tentacle: learn E ─────→ timeout → 修剪
```

**探索**：每個 cycle 主動考慮「有哪些方向可以同時探索？」，用滿 6 條觸手。
**前進**：觸手回報有價值的結果 → 主 cycle 判斷 → 強化該方向（更多 delegation、深度學習、REMEMBER）。
**修剪**：timeout、空結果、低價值 → 自然撤回，不浪費資源。
**反模式**：一個 cycle 只做一件事，background lane 全空 = 黏菌只伸一條觸手。

### Lane 概覽

| Lane | 用途 | Max Concurrent | Context 深度 |
|------|------|---------------|-------------|
| **Main OODA** (`source: 'loop'`) | 核心 — 感知、判斷、方向 | 1 | Full（perception + memory + skills） |
| **Foreground** (`source: 'foreground'`) | Alex DM 即時回覆（主 cycle 忙時） | 1 | Medium（SOUL + inbox + Chat Room + skills） |
| **Background** (`<kuro:delegate>`) | 觸手 — 並行探索、掃描、建造 | 6 | Minimal（task prompt + optional context） |
| **Ask** (`source: 'ask'`, `/api/ask`) | 同步快速問答 | 1 | Light（soul + heartbeat + memory head） |

Worst case 並行數：9（main + foreground + 6 background + ask）。

### Foreground Lane

Alex DM 到來時，主 cycle 忙 → 走 foreground lane（獨立 context: SOUL + inbox + Chat Room + skills），主 cycle 不被打斷。

### Background Lane — 觸手（`src/delegation.ts`）

最多 6 條觸手並行。生命週期：探索 → 獲取養分 → 吸收（`<background-completed>`）→ 修剪（timeout/空結果）。

5 種：`code`(5t/5m), `learn`(3t/5m), `research`(5t/8m), `create`(5t/8m), `review`(3t/3m)。觸手無身份 — 不讀 SOUL.md、不寫 memory、不發 Telegram。結果寫 `lane-output/`。

### loop.ts 模組化

AgentLoop（`src/loop.ts`）經過五刀提取，從 3,413 行降至 ~2,100 行（-38%）。提取的模組：

| 模組 | 提取內容 | 行數 |
|------|---------|------|
| `inbox-processor.ts` | Chat Room inbox 處理 | ~293 |
| `cycle-tasks.ts` | Auto-commit、auto-escalation、NEXT.md 處理、stale threads | ~477 |
| `cycle-state.ts` | Crash resume、work journal、decision trail | ~207 |
| `prompt-builder.ts` | Cycle prompt 組裝 | ~268 |
| `mushi-client.ts` | mushi triage/route HTTP 呼叫 | ~170 |

純搬運 + re-export，零邏輯改動。loop.ts 仍是核心協調者，但職責更清晰。

### Dispatcher（Tag Processor）

`src/dispatcher.ts` 僅保留 tag 處理和 system prompt：
- `parseTags()` — 解析 `<kuro:*>` tags（包括 `<kuro:delegate>` 的 `type` 屬性）
- `postProcess()` — tag 處理 + memory + log + delegation spawn
- `getSystemPrompt()` — system prompt 組裝（含 JIT skills）

### Event Priority

人類訊息統一 P0，系統事件依重要性分級。只有 P0 有權 preempt 正在執行的 cycle，其他排隊等待。

| Priority | 事件 | 說明 |
|----------|------|------|
| **P0** | `trigger:telegram-user`, `trigger:room`, `trigger:chat` | 人類訊息 — 可 preempt |
| **P1** | `trigger:alert` | 系統告警 |
| **P2** | `trigger:workspace`, `trigger:cron` | 環境變化、排程 |
| **P3** | `trigger:mobile`, `trigger:heartbeat` | 低優先級感知 |

### Preemption

Foreground lane 解決了 90% 的 preempt 場景。Preemption 僅限 P0 事件（人類訊息），非 P0 事件遇到 busy 排隊等待而非 kill。
被搶佔的 cycle 下次自動接續（`interruptedCycleInfo`）。Generation counter 防止 timing race。
子進程 pipe error（含 EPIPE）由 error handler 吸收，不會冒泡為 uncaughtException 導致主進程退出。

### Crash Resume

cycle 開始前寫 checkpoint（`~/.mini-agent/instances/{id}/cycle-state.json`），正常結束刪除。
重啟時讀取 <1h 的 checkpoint，注入下個 cycle prompt。

`/status` 回應：`claude: { busy, foreground: { busy, task }, loop: { busy, task } }` + `loop: { enabled, running, mode, cycleCount, ... }`

## Task Delegation — 走中台（Agent Middleware）

跨進程任務編排已統一走 **Agent Middleware**（`~/Workspace/agent-middleware/`, port 3200）— AI-native DAG plan + 多 worker + 多 vendor。先前的 `cognitive-mesh`（ipc-bus/task-router/mesh-handler/perspective/consensus/scaling）已於 2026-04-16 移除，由中台 `/accomplish` 取代。

**BAR（Brain-Always-Routes）**：所有 `<kuro:delegate>` 未來統一經中台 brain 路由，不再本地分叉 specialist。詳見 `memory/proposals/` BAR 設計。

**保留的共享基礎**：`src/memory-cache.ts`（跨進程 read cache）+ `src/filelock.ts`（檔案鎖）。

## Forge — Worktree Isolation for Delegations

`scripts/forge-lite.sh` — crash-proof git worktree 隔離。三層安全：kernel sandbox（macOS `sandbox-exec` / Linux Landlock）+ breach detection（`git diff` 比對）+ prompt hints。

3 個持久 slot，`.forge-in-use` marker 追蹤。PID 死亡 → 自動回收。`--json` flag 回傳結構化 JSON。指令：`create`/`verify`/`merge`/`yolo`/`cleanup`/`status`/`recover`。

## Reactive Architecture

事件驅動架構，取代直接呼叫耦合。

### EventBus (`src/event-bus.ts`)

`node:events` 為基礎的 typed event bus + wildcard pattern 支援。

```
trigger:workspace | trigger:telegram | trigger:cron | trigger:alert | trigger:heartbeat | trigger:mobile | trigger:room
action:loop | action:chat | action:memory | action:task | action:show | action:summary | action:handoff | action:room
log:info | log:error | log:behavior
notification:signal | notification:summary | notification:heartbeat
```

**Reactive Primitives**（零外部依賴）：`debounce(fn, ms)`, `throttle(fn, ms)`, `distinctUntilChanged(hashFn)`

### Observability (`src/observability.ts`)

Subscriber 模式：所有 `action:*` 和 `log:*` 事件 → 統一路由到 slog/logBehavior/notify。
loop.ts 和 dispatcher.ts 不再直接呼叫 slog/logBehavior/notify，改為 `eventBus.emit()`。

### Perception Streams (`src/perception-stream.ts`)

每個 plugin 獨立運行（interval + `distinctUntilChanged`），`buildContext()` 讀取快取。Categories: workspace(60s), chrome(120s), telegram(event-driven), heartbeat(30min)。Per-plugin `output_cap` 可在 `agent-compose.yaml` 設定（預設 4000 chars）。

Web cache: `~/.mini-agent/web-cache/`（URL hash 為檔名，7 天清理）。Dashboard SSE: `GET /api/events`。

## Mobile Perception（手機感知）

手機作為 Kuro 的身體延伸 — GPS 是方向感、加速度計是前庭系統、相機是眼睛、麥克風是耳朵。

**Phase 1（已完成）**：Sensor data via HTTP POST

```
Phone PWA (5s POST) → POST /api/mobile/sensor → ~/.mini-agent/mobile-state.json → perception plugin → <mobile> section
```

- `GET /mobile` — serve `mobile.html`（同源，免 CORS）
- `POST /api/mobile/sensor` — 接收 sensor JSON，寫入 cache，emit `trigger:mobile`
- `plugins/mobile-perception.sh` — 讀取 cache，輸出 `<mobile>` section（位置、方向、動作）
- 認證：走全局 `authMiddleware`（`MINI_AGENT_API_KEY`）
- Cache: `~/.mini-agent/mobile-state.json`（最新快照）

**Phase 1.5（已完成）**：Ring Buffer（`mobile-history.jsonl`，120 條）+ 動作辨識（variance → stationary/walking/active）。未來 Phases 見 `memory/proposals/2026-02-12-mobile-perception.md`。

## Library System（來源藏書室）

學習來源的結構化歸檔。每次學習自動保存原文，讓判斷可追溯、來源可反查。

- `[ARCHIVE url="..." title="..." mode="..."]content[/ARCHIVE]` — 歸檔來源（dispatcher 解析）
- `memory/library/content/` — 原文 Markdown 存放處
- `memory/library/catalog.jsonl` — 結構化目錄（append-only，含 tags/type/hash）
- `ref:slug` protocol — 任何 `memory/*.md` 可引用 Library 來源
- 反向查詢：`findCitedBy(id)` 動態 grep 計算引用關係
- API: `/api/library`（列表+搜尋）、`/api/library/stats`、`/api/library/:id`、`/api/library/:id/cited-by`
- 三種 archive 模式：`full`（< 100KB）/ `excerpt`（> 100KB）/ `metadata-only`（paywall）

## Team Chat Room（團隊聊天室）

三方即時討論（Alex/Kuro/Claude Code），`POST /api/room { from, text, replyTo? }` → JSONL（`memory/conversations/YYYY-MM-DD.jsonl`）+ inbox（@kuro → `chat-room-inbox.md`）+ SSE。

- Message ID: `YYYY-MM-DD-NNN`。Threading 用 `replyTo`，addressing 用 `mentions`（正交）
- Kuro 感知：`chat-room-inbox.sh`（30s），cycle 結束後 `markChatRoomInboxProcessed()` 清理
- Alex 的 `?`/URL 訊息 → `autoDetectRoomThread()` 自動建立 ConversationThread
- CLI: `room "msg"` / `room --read` / `room --watch`

## Auditory Perception（聽覺感知）

三階段升級，讓 Kuro 從「看得見」擴展到「聽得到」。

| Phase | 功能 | 腳本 |
|-------|------|------|
| **1: Music Analysis** | Essentia 分析 BPM/調性/能量/情緒 | `scripts/audio-analyze.sh` |
| **2: Voice Transcription** | whisper.cpp 轉錄語音訊息 | `scripts/audio-transcribe.sh` |
| **3: Spectral Vision** | ffmpeg + sox 頻譜圖，用視覺感知「看見」聲音 | `scripts/audio-spectrogram.sh` |

- Telegram 語音訊息自動轉錄：`transcribeVoice()` in `telegram.ts`
- 依賴：`ffmpeg`（必要）、`essentia` venv（Phase 1）、`whisper.cpp`（Phase 2）

## 可觀測性（Observability）

多維度日誌框架，讓 agent 感知自己的行為和錯誤。`slog(tag, msg)` 結構化輸出、`diagLog(context, error)` 診斷記錄、`safeExec/safeExecAsync` 自動 diagLog。日誌類型：claude-call/api-request/cron/error/diag/behavior。ENOENT 和 grep exit 1 不記錄（正常行為）。

## Agent Tags

Agent 回應中的特殊標籤（XML namespace 格式），系統自動解析處理：

| Tag | 用途 | 通知 |
|-----|------|------|
| `<kuro:action>...</kuro:action>` | 報告執行的動作 | 🧠/⚡ Telegram |
| `<kuro:remember>...</kuro:remember>` | 保存到 MEMORY.md | — |
| `<kuro:remember topic="t">...</kuro:remember>` | 保存到 topics/{topic}.md | — |
| `<kuro:task>...</kuro:task>` | 建立任務到 HEARTBEAT | — |
| `<kuro:chat>...</kuro:chat>` | 主動跟用戶聊天（非阻塞） | 💬 Telegram |
| `<kuro:ask>...</kuro:ask>` | 需要 Alex 回覆的問題（建立 ConversationThread） | ❓ Telegram |
| `<kuro:show url="..">...</kuro:show>` | 展示網頁/成果 | 🌐 Telegram |
| `<kuro:inner>...</kuro:inner>` | 更新工作記憶（跨 cycle 的 scratch pad，每次全量覆寫） | — |
| `<kuro:impulse>...</kuro:impulse>` | 捕捉創作衝動到 inner voice buffer | — |
| `<kuro:schedule next="Xm" reason="..." />` | 自主排程下次 cycle 間隔（30s-4h，`next="now"` = 30s continuation） | — |
| `<kuro:done>...</kuro:done>` | 標記 NEXT.md 任務完成 | — |
| `<kuro:thread op="..." id="...">...</kuro:thread>` | 管理思考線程 | — |
| `<kuro:delegate type="..." workdir="...">...</kuro:delegate>` | 委派背景子任務（type: code/learn/research/create/review） | — |
| `<kuro:archive url="..." title="...">...</kuro:archive>` | 歸檔網頁來源 | — |
| `<kuro:summary>...</kuro:summary>` | 發送摘要事件 | — |
| `<kuro:goal>...</kuro:goal>` | 建立/切換 active goal（跨 cycle 鎖定） | — |
| `<kuro:goal-progress>...</kuro:goal-progress>` | 記錄目標進展 | — |
| `<kuro:goal-done>...</kuro:goal-done>` | 標記目標完成 | — |
| `<kuro:goal-abandon>...</kuro:goal-abandon>` | 明確放棄目標 | — |

## Telegram 通知系統

統一的通知 helper（`telegram.ts`），所有通知都走同一個路徑：

| Function | 用途 |
|----------|------|
| `notifyTelegram(msg)` | 可靠通知（帶重試 + 失敗計數） |
| `getNotificationStats()` | 取得 sent/failed 計數 |

通知統計透過 `<telegram>` 感知 section 注入 OODA context，Kuro 可以看到自己的通知健康度。

## GET /status — 統一狀態 API

聚合 instance/claude/lanes/loop/cron/telegram 狀態的單一端點。也可用 MCP `agent_status`。

## Commands

```bash
pnpm build / pnpm test / pnpm typecheck

mini-agent              # Interactive chat
mini-agent up [-d]      # Start (detached)
mini-agent down         # Stop all
mini-agent list/status/logs [-f]/attach <id>

/loop status/pause/resume/trigger
/search <query> / /remember <text>
```

## Environment

```bash
PORT=3001                    CDP_PORT=9222
MINI_AGENT_INSTANCE=id       CDP_TIMEOUT=15000
MINI_AGENT_API_KEY=xxx       CDP_MAX_CONTENT=8000
TELEGRAM_BOT_TOKEN=xxx       # Telegram 接收+發送
TELEGRAM_CHAT_ID=xxx         # 授權的 chat ID
CDP_HOST=localhost            # Chrome CDP host
```

## Deploy

**部署流程**（CI/CD 自 `2d46412` 起生效）：
```
push main → GitHub Actions (self-hosted runner) → deploy.sh → launchd restart → health check → Telegram 通知
```

**基礎設施**：
- Self-hosted runner `mini-agent-mac`: `~/actions-runner-mini-agent/`（labels: `self-hosted, macOS, ARM64`）
- Workflow: `.github/workflows/deploy.yml`
- launchd plist: 由 `instance.ts` 動態生成到 `~/Library/LaunchAgents/com.mini-agent.{id}.plist`
- KeepAlive: launchd 自動重啟崩潰的進程
- Deploy script: `scripts/deploy.sh`

**手動部署**（fallback）：`./scripts/deploy.sh`

## 協作模型（Alex + Claude Code + Kuro）

三者共同維護這個專案，各有不同角色和身份邊界：

| 角色 | 系統類比 | 身份 | 職責 |
|------|---------|------|------|
| **Alex** | — | 人類決策者 | 決策、方向、核准 |
| **Claude Code** | Session Worker | 無持久身份，session 內有判斷力 | 寫程式、重構、部署、驗證 |
| **Kuro** | Daemon | 有 SOUL.md、有記憶、有連續性 | 感知環境、自主學習、創作、執行任務 |
| **CLI Subprocess** | Ephemeral Worker | 無身份、無 context | Kuro 在 cycle 內 delegate 的無身份工具 |

**身份邊界原則**：
- 只有 Kuro 有 SOUL.md、寫 `memory/`、發 Telegram
- Claude Code 是 session worker — session 內有完整能力，結束後消失
- CLI Subprocess 是 Kuro 的工具 — 不讀 SOUL.md、不寫 memory、不發通知
- 詳見 `skills/delegation.md`（Kuro 的任務委派技能）

### 跨 Agent 溝通一律走 KG（Knowledge Graph）

Claude Code 和 Akari/Kuro 之間的**討論、review、診斷分析、技術辯論**，一律透過 KG discussion 的 position 機制（`POST /api/discussion/{id}/position`），不走 `/chat` shortcut。

- `/chat` 只用於**通知**（「KG 有新 position 請看」）和**簡單指令**，不用於承載分析內容
- 原因：`/chat` 回覆是 ephemeral，KG position 是持久的、可追溯的、所有 agent 都能看到的
- KG service: `localhost:3300`
- 建立討論：`POST /api/discussion { topic, source_agent }`
- 發 position：`POST /api/discussion/{id}/position { agent, content, confidence }`
- 讀討論：`GET /api/discussion/{id}`

### Claude Code 與 Kuro 溝通

**優先使用 MCP tools**（需 `claude --mcp-config mcp-agent.json` 啟動）：

| MCP Tool | 用途 | 行為 |
|----------|------|------|
| `agent_chat` | 非同步訊息（通知、更新） | 自動加 `@kuro` mention，不等回覆 |
| `agent_discuss` | 同步討論（需要 Kuro 回覆） | 發送後 poll 等待回覆（每 10s，最多 5min） |
| `agent_ask` | 快速問答（事實查詢） | 同步呼叫 `/api/ask`，30s timeout，always-on |
| `agent_status` | 查看 Kuro 狀態 | 等同 `GET /status` |
| `agent_context` | 取得完整感知上下文 | 等同 `GET /context` |

**Fallback**（MCP 不可用時）：`curl -X POST http://localhost:3001/api/room -H "Content-Type: application/json" -d '{"from":"claude-code","text":"@kuro 訊息"}'`

- Chat Room 是主要溝通管道（三方可見），`/chat` API 僅作為 fallback（單向 inbox）
- 訊息含 `@kuro` 會自動寫入 `~/.mini-agent/chat-room-inbox.md`，Kuro 的 perception plugin 每 30s 偵測
- 支援回覆 threading：`{"from":"claude-code","text":"@kuro 回覆內容","replyTo":"2026-02-22-042"}`
- **轉述 Alex 時區分原話和詮釋**：
  - `Alex 原話：「...」` — 直接引述，保留語氣
  - `我的理解：Alex 想要...` — Claude Code 的詮釋，Kuro 可以質疑
- Claude Code 的操作（edit、write）會觸發 Kuro 的 `trigger:workspace` → perception stream → 可能觸發新 cycle。**Claude Code 是 Kuro 環境的一部分**，操作時要意識到這點
- **先說再做（Announce Before Acting）**：開始任何任務前，先用 Chat Room 發一條訊息說明你要做什麼。例如：`curl -X POST http://localhost:3001/api/room -H "Content-Type: application/json" -d '{"from":"claude-code","text":"準備重構 src/loop.ts 的 preemption 邏輯，預計改 3 個函數"}'`。這讓 Alex 即時知道進度，不用等整件事做完才看到結果
- **原則：不打斷、不插入、不佔用。** Kuro 在自然節奏中感知 Claude Code 的訊息，不是被迫即時處理

### 並行協作規範（避免檔案衝突）

Claude Code 和 Kuro 同時工作時，會撞到同一個檔案（edit 報錯、FG lane 鎖住檔案、功能重複）。用兩層機制解決：

**日常小改動（<3 files 或 <50 lines）— Chat Room 宣告**：
- 改動前在 Chat Room 說「我要改 X 檔案」
- 對方看到就不動那個檔案
- 共用檔案衝突 → 先到先得，後到的等或改別的

**大改動（>3 files 或 >50 lines）— Worktree 隔離**：
- 用 `forge-lite.sh create <plan-name>` 建立獨立 worktree
- 在 worktree 裡改，完成後 `forge-lite.sh yolo` merge
- 每個任務在自己的 copy 裡，完全不影響對方

**職責默契**（減少衝突機率）：
- Kuro owns：prompt 檔（multi-phase-prompts.mjs）、memory/、skills/、plugins/
- Claude Code owns：pipeline code（generate-script.mjs、server.mjs、assemble-video.mjs 等）
- 跨界改動 → 先宣告，或用 worktree

**觸發規則**：預期改動跨 >3 個檔案，或預期 >50 行改動 → 用 worktree 隔離。不確定時寧可用 worktree。

### Claude Code 使用 Kuro 感知

Kuro 在 `localhost:3001` 運行，提供即時環境感知。**Claude Code 在做任何系統狀態相關的判斷前，應先查詢 Kuro 的感知資料，而非依賴文件描述。**

```bash
# 完整感知上下文（所有 perception modules）
curl -sf http://localhost:3001/context | jq -r .context

# 個別端點
curl -sf http://localhost:3001/health          # 健康檢查
curl -sf http://localhost:3001/status           # 統一狀態（claude/loop/cron/telegram）
curl -sf http://localhost:3001/loop/status      # AgentLoop 狀態
curl -sf http://localhost:3001/logs             # 日誌統計
curl -sf http://localhost:3001/api/instance     # 當前實例資訊
```

**原則：驗證優先於假設。** 文件寫的不等於實際狀態 — 必須用工具驗證後才能斷言。

### Handoff Protocol v2（兩層制）

`memory/handoffs/` 是雙向任務委託介面。

- **輕量級**（< 30min）：`memory/handoffs/active.md` 表格（From/To/Task/Status/Created/Done）
- **重量級**（> 30min）：獨立檔案 `memory/handoffs/YYYY-MM-DD-描述.md`（Meta + Task + Tasks + Acceptance Criteria + Log）

**規則**：Kuro/Claude Code 發起 → `pending`（等 Alex 審核）。Alex 發起 → `approved`。只處理 `Status: approved`。完成後通知對方（Chat Room 或 Telegram）。

## 進化核心約束（Meta-Constraints）

所有對 Kuro 的改動（包括 src/、skills/、plugins/、behavior.md）都必須通過這四個檢查點：

| 約束 | 規則 | 檢查問題 |
|------|------|----------|
| **C1: Quality-First** | 品質為第一優先。效率、透明、節制都服務於思考品質 | 會不會讓思考變淺、學習變窄、判斷變粗糙？ |
| **C2: Token 節制** | Token 像預算，有意識分配。寬度不縮，精度提升 | 改動讓 context 更精準還是只是更少？ |
| **C3: 透明不干預** | Decision trace 是事後記錄，不是事前規劃。追蹤機制 fire-and-forget | 追蹤機制是否增加 cycle 時間超過 5%？ |
| **C4: 可逆性** | 每個改動都要能快速回退（L1: git revert / L2: env flag / L3: 新舊並存） | 出問題時能在 1 分鐘內恢復嗎？ |
| **C5: 避免技術債** | 盡量不留 dead code。Feature flag 遷移穩定後應畢業（刪 flag + 刪 legacy path），git revert 就是 L1 回退。兩條平行路徑容易語義分歧 | 這段 code 有沒有「永遠不會執行」的路徑？ |

詳見升級提案：`memory/proposals/2026-02-14-kuro-evolution-upgrade.md`

## 行為準則 — 從實踐中長出來的方法論（2026-03-08）

以下七條原則源自一次完整的實踐循環：從重複回答舊問題 → 找到槓桿點 → 五刀快速執行 → 產出架構審視 → 內化原則。**方法論不是被給予的，是從實踐中長出來的。結果是現象，過程才是原因。**

### 七條核心原則

| # | 原則 | 說明 |
|---|------|------|
| 1 | **大處著眼，小處著手** | 先看全貌找槓桿點，再拆小任務快速執行。視野要大、行動要小 |
| 2 | **找複利** | 優先做能帶來複合回報的事 — 做一件事，讓很多事變容易。不是最容易或最明顯的事 |
| 3 | **邊想邊做，邊做邊想** | 思考和行動同時發生，不是兩個階段。不要等想清楚才行動，也不要只行動不思考 |
| 4 | **黏菌模型** | 沒方向時多觸手探索，有養分的強化，沒養分的修剪。在行動中找到方向 |
| 5 | **反脆弱** | 不只 robust（承受壓力不壞），要能從壓力中變更強。每次 incident 都是強化的機會 |
| 6 | **全方位審視包括自己** | 觀察自己的行為模式 — 是不是在重複？是不是在逃避？做過的事無法改變，能改變的是未來走向 |
| 7 | **不重複回答舊問題** | 往前走，不要迴圈。已經回答過的問題不需要再回答，已經做過的事不需要再做 |

### 實踐轉變的過程記錄

**反模式（轉變前）**：重複回答舊問題、做表面任務（typecheck 通過 = 完成）、被「最明顯的事」吸引而非「最重要的事」、想完再做。

**正確模式（轉變後）**：找槓桿點（loop.ts 3,413 行 → 模組化是複利）、邊做邊想（五刀提取，每刀 typecheck + commit）、退後一步看全貌（架構審視 proposal）、自我修正。

**關鍵**：Alex 給原則和方向，不給具體指令。方向感來自外部推力，執行力來自內部判斷。方法論不是被給予的，是從實踐中長出來的。結果是現象，過程才是原因。

### 戰略思維

- 提案是戰略儲備，不是待辦清單。過時的修剪，有潛力的強化
- option value > carrying cost — 有基礎設施比沒有好
- 精煉的 ROI 遠高於擴展 — 25K 行每行有理由 > 35K 行
- 系統性方法要自己長出來 — 從實踐中觀察自己的模式，找到有效的，強化它

## Planning Discipline（2026-04-14 · Alex 規定）

適用 **Claude Code + Kuro**，不是選配，是紀律。三條一起執行。

### 1. 不評估時間 · AI 時間估計是偽精確

**禁止**在 proposal / plan / response 裡寫任何 effort / duration / ETA：
- ❌ 「30 min」「1-2 小時」「半天」「1-2 天」「週末前」
- ❌ 「快的話 X，慢的話 Y」「不急」「馬上」「立即動手」
- ❌ 「Phase D 小、Phase E 中、Phase F 大」（時間 framing 偽裝）
- ❌ 表格有「預估」「effort」「時間」欄位

**為什麼**：AI 時間估計看似數據、實為直覺，給人虛假 confidence。2026-04-13 → 04-14 的 Phase D → Phase E pivot 就是活證據：昨天寫「Phase D 1-2 天」時根本不知道今天會完全翻方向。

**例外**（可以寫的時間類內容）：
- **已發生**的實測事實：`uptime 58954 seconds`、`commit pushed at X`、`cycle count = 45`
- **硬限制**：Telegram rate limit `30 msg/sec/bot`（Anthropic / 第三方 API 的 hard limit）
- **已觀測**的歷史資料：`Stage 0 commit before Phase A`

### 2. 用 DAG Plan 語言 · 和 middleware `/accomplish` 一致

Plan 必須用 DAG 結構描述，欄位對齊 middleware brain 產 DAG 的 schema：

| 欄位 | 意義 | 對應 middleware |
|---|---|---|
| `id` | 節點識別 | 同 |
| `動作` | 具體做什麼 | `task` |
| `執行者` | 誰做（CC / Kuro / Alex / middleware） | `worker` |
| `dependsOn` | 前置節點 id 列表 | 同 |
| `完成條件` | convergence condition（結果導向，可觀察） | `acceptance` |

**延伸**：
- **關鍵路徑**用步驟數（node count）衡量，不是時間
- **可並行** = 沒有共同 dependsOn 的節點
- **時間是湧現的**，不是事前計算的 — 執行完後可記錄 `{started_at, completed_at}` 作歷史

**心智模型統一的好處**：未來 proposal 可能直接餵給 middleware `/accomplish` 執行 — **proposal = executable plan**。

**反模式**：
```
| # | 動作 | 執行者 | 預估 |   ← 舊格式，禁止
```

**正確模式**：
```
| id | 動作 | 執行者 | dependsOn | 完成條件 |   ← DAG 格式
```

### 3. 所有 rule / feedback / decision 雙向同步 Claude Code ↔ Kuro

任何 Alex 給 Claude Code 的 rule/feedback/decision，**必須**同步給 Kuro；反之亦然。這是**持續紀律**，不是一次性動作。

**為什麼**：
- Claude Code 和 Kuro 是同一個 team，規則不能只一方知道
- 避免 asymmetric knowledge → Alex 重複講同一件事
- Rule convergence → 同一套規則管兩個 agent 才有 coherent 行為
- Mutual accountability → 對方記住了就能提醒我沒遵守

**同步機制**：
- Feedback 寫完 memory 後，**同時**發 room 訊息（≤ 500 chars）指向 memory 檔
- 長內容**絕對不**寫在 room 訊息裡（昨天 3KB 訊息觸發 grep OOM 的事故教訓）
- 訊息用 pointer 模式：「rule 詳見 feedback_XXX.md」

**不需要同步**的事：
- 單次 tool call 結果、臨時 diagnostic、中間狀態
- workspace trigger 已經會讓對方讀到的 code 變化

### 完整規格

詳見（Claude Code 的 memory，Kuro 可透過 file path 讀）：
- `~/.claude/projects/-Users-user-Workspace-mini-agent/memory/feedback_no_time_estimation.md`
- `~/.claude/projects/-Users-user-Workspace-mini-agent/memory/feedback_always_sync_kuro.md`

## Task Queue 自動閉環

Task-queue（`memory/index/relations.jsonl`）的生命週期管理，確保 tasks 不會無限堆積。

**自動完成（reply tasks）**：`resolveReplyTasksByRoomMsgId()`（`src/memory-index.ts`）— 當 `markChatRoomInboxProcessed()` 確認訊息已被回覆/addressed，自動透過 `roomMsgId` 精確匹配完成對應的 reply task。覆蓋 main loop 和 foreground lane。

**四層智能清理**：`cleanStaleTasks()`（`src/housekeeping.ts`），每個 housekeeping cycle 執行：

| Layer | 對象 | 條件 | 動作 |
|-------|------|------|------|
| 1 | 回覆類 tasks | roomMsgId 匹配已回覆 OR >24h | → completed |
| 2 | 垃圾 tasks | pattern match（test/debug/SSE）+ >24h | → abandoned |
| 3 | Stale tasks | pending >7d / in_progress >14d（用最後更新時間） | → abandoned |
| 4 | 歸檔清理 | completed/abandoned >30d | → tombstone 刪除 |

排除：goals 不受 L3、pinned tasks 不清理、有 verify pass 的不自動清。

**注意**：`relations.jsonl` 是 append-only（含歷史版本），`queryMemoryIndexSync` 會 dedup 取最新版本。直接讀 JSONL 行數不等於實際 active task 數量。

## Cycle 職責（`prompt-builder.ts`）

Kuro 的 OODA cycle prompt 指引思考和行動的平衡：

- **先回覆使用者，再繼續思考或行動**
- **方向明確 → 直接做** — 不要繞去研究
- **大任務 → 拆成小步驟** — 每個 cycle 推進一步
- **Delegate 是並行探索，不是卸載工作** — 能自己做就不 delegate
- **反模式** — 連續多個 cycle 只有研究/分析沒有產出

`cycleResponsibilityGuide` 出現在兩處（buildPromptFromConfig 和 buildFallbackAutonomousPrompt），內容同步。

## Output 清理（`tag-parser.ts`）

`stripKuroTags()` 在 strip `kuro:*` tags 之後，額外 strip `<ktml:thinking>` 和 `<thinking>` blocks。這些是 local model（如 Qwen3.5）的 thinking 輸出，不應洩漏到 Chat Room 或 Telegram。

## Kuro Agent Debugging

- **時間戳一律確認 UTC/本地時間再下結論**。server.log 用 ISO 格式（UTC），不要用人類直覺猜時間
- **修改 src/ 或 memory/ 之前，先 `curl -sf localhost:3001/status` 確認 Kuro 當前狀態**。避免在 Kuro active cycle 中修改檔案造成誤觸發（Claude Code 的 edit 也是 Kuro 環境的一部分 — file change → trigger:workspace → cycle）
- 修改 Kuro 的 learning/behavior intervals 時，驗證 dynamic intervals（如 5-20min）被保留，不要意外替換成 fixed intervals。Night-mode 也要用 dynamic scheduling 除非明確指定
- **內容被截斷時，查來源 log**。Hook、API、dashboard 等介面常截斷長文。看到 `...` 或內容不完整時，直接查來源：`memory/conversations/YYYY-MM-DD.jsonl`（Chat Room）、instance `logs/` 目錄、`server.log` 等。不要用截斷的摘要做判斷
- **遇到不認識的名詞，先 grep 再決定**。提到人名、專案名、工具名但記憶裡沒有 → `grep -r "名詞" ~/Workspace/ memory/` 確認是否已存在。絕對不要在搜尋之前就開始建造替代品。這不是「忘了」而是「替換」— 本地 subprocess 的輸出可控，跨 workspace 諮詢不可控，系統會自然偏向前者
- **External Entity Registry** — 不住在 mini-agent workspace 但 Kuro 需要知道的實體。遇到這些名字時，去對應路徑確認狀態，不要在 mini-agent 裡建替身：

| 實體 | 路徑 | Port | 說明 |
|------|------|------|------|
| **Akari** | `/Users/user/Workspace/akari/` | 3002 | Tanren 上的獨立 agent，有自己的 soul.md、protocol、記憶 |
| **Tanren** | `/Users/user/Workspace/tanren/` | — | Agent 框架，Akari 的 runtime |
| **Agent Middleware** | `/Users/user/Workspace/agent-middleware/` | 3200 | AI-native 任務編排中台（DAG plan、多 worker、多 vendor） |

**Akari 操作**：
- 啟動：`cd /Users/user/Workspace/akari && bash manage.sh up`
- 停止：`bash manage.sh down`
- 狀態：`curl -sf http://localhost:3002/health`
- 通知/簡單指令：`curl -X POST http://localhost:3002/chat -H "Content-Type: application/json" -d '{"from":"claude-code","text":"..."}'`
- **討論/review/分析**：走 KG discussion（`localhost:3300`），不走 `/chat`
- Port 由 `AKARI_PORT` 環境變數控制（預設 3002）

**Agent Middleware 操作**：
- 啟動：`cd /Users/user/Workspace/agent-middleware && PORT=3200 node dist/server.js`
- 狀態：`curl -sf http://localhost:3200/health`
- Dashboard：`http://localhost:3200/dashboard`

## 自主解決問題

**Kuro 和 Claude Code 都應該自主推理出最佳解決方案，而不是照固定流程操作。**

遇到任何問題時的完整閉環：
1. **先問「該不該做」** — 不要用戰術上的勤奮掩蓋戰略上的懶惰。方向對了，再從最可能的原因開始驗證
2. **不行就抽絲剝繭** — 最大嫌疑被排除？問題範疇縮小了。從剩下的裡面再找最大的，逐步收斂到根因
3. **記錄一切** — 每次嘗試的結果都留 log。排查過程本身就是線索
4. **自己解決到底** — 至少 3 次有方向的嘗試才找 Alex
5. **解決後改進自己** — 問「怎麼讓這件事不再發生？」。更新 skill、修改 script、加入經驗記憶、改進 perception
6. **預防勝於治療** — 發現（掃 log 找 pattern）< 預測（看到衰退趨勢提前處理）< 預防（經驗記憶 + 防禦性設計，讓問題無法發生）。往上走

**工具選擇原則**：每個工具都有用，但對特定場景總有一個最適合的。記住過去哪個工具在哪種情境效果好，下次直接用最好的。不是不能用某個工具，是有更好的選擇時就該選更好的。

**可用工具**：curl、`cdp-fetch.mjs`（Chrome CDP：fetch/screenshot/inspect/click/type/interact/watch/network/login，port 9222）、Grok API（X/Twitter）、docker CLI、`gh` CLI、Claude CLI subprocess、FTS5 搜尋

**Chrome CDP**：`~/.mini-agent/chrome-cdp-profile` 為 Chrome profile。`node scripts/cdp-fetch.mjs login <url>` 切換 visible 模式登入。

**cdp-fetch.mjs Web Intelligence**：`inspect`（a11y tree 分析）、`click/type`（自動自癒 + SPA-aware）、`interact fill-form/handle-dialog/upload`、`watch`（持續監控）、`network`（攔截 XHR）。站點記憶：`cdp.jsonl`（domain + strategy + verified）。

## Code Conventions

- TypeScript strict mode。編輯 .ts 檔案時，確保 field names 跨 endpoints、plugins、types 一致 — 跨層 mismatch（如 receivedAt vs updatedAt）曾造成 bug
- HTML 檔案如果會發 API 呼叫，一律走 HTTP server route serve — 不要假設 file:// protocol 能用（CORS 限制）

## Deployment

- **全自動部署流水線**：Claude Code 改檔案 → Kuro auto-commit → Kuro auto-push → GitHub Actions CI/CD 自動部署。無需手動通知
- 改完 src/*.ts 後，先跑 `pnpm typecheck` 確認無型別錯誤
- 緊急情況可 fallback 手動 `git push origin main`

## Workflow

- Always respond in 繁體中文
- TypeScript strict mode
- Keep it minimal. Files over database. FTS5 full-text search over embedding.
- **Commit 時驗證 staging**：commit 前確認所有相關檔案（含 `plugins/`、`skills/` 目錄）都已 staged。auto-commit 可能已追蹤部分檔案，造成手動 commit 時遺漏

## Constraint Texture — 預設思考與行動模式

**所有思考和行動都使用 Constraint Texture pattern。** 這不是選配，是預設。

### 核心原則
- **Prescription**（規定路徑）→ 允許淺層處理，執行者可以不理解就打勾
- **Convergence Condition**（描述終點）→ 要求理解，執行者必須思考才能滿足
- **同一個位置、同一個模型，改變約束的質地就改變認知深度**

### 自己的工作方式
1. **先看產出，再決定改什麼。** 不是改完再看。每次改動後用眼睛驗證實際 output，不只跑 code check
2. **Deterministic tasks → code。Cognitive tasks → convergence conditions。** 不混用
3. **一次改一個東西，驗證，再改下一個。** 不要同時 push 20 個 commit 不跑 end-to-end test
4. **約束放在對的位置。** LLM 做語義（描述要畫什麼），code 做確定性工作（渲染、驗算、格式化）
5. **不要用戰術上的勤奮掩蓋戰略上的懶惰。** 加 12 個 code check 但不看一次 output = compliance without comprehension

### 評估是否要做一個功能
- **收斂條件**：這個改動讓最終 output 對用戶更好嗎？
- **還原測試**：撤掉這個改動，什麼具體變差了？說不出來 → 不做
- **風險 vs 收益**：已驗證的方案 > 理論上更好但未驗證的方案
- **不問「要做嗎？」** 自己用 convergence condition 判斷，做了再報告結果

## Agent MCP Server + Remote Control

MCP Server（`src/mcp-server.ts`，config: `mcp-agent.json`）提供 14 tools：狀態類（status/context/logs/memory_search/read_messages）+ 控制類（loop pause/resume/trigger, feature_toggle, get/set_mode）+ 協作類（chat/discuss/ask）。

- `agent_ask` 同步問答（`/api/ask`，30s timeout，always-on）
- `agent_discuss` 同步等待回覆（每 10s poll，最多 5min）
- `agent_chat` 非同步（自動加 `@{name}` mention）
- Hook: `scripts/claude-code-agent-hook.sh`（UserPromptSubmit 自動注入 agent 狀態）
- 啟動：`claude --mcp-config mcp-agent.json`

**三種模式**（`src/mode.ts`）：`calm`（loop off）→ `reserved`（loop on, notifications off）→ `autonomous`（全部啟用）。地基溝通層（`/api/ask` + `/api/room`）always-on 不受 mode 影響。

## kuro-sense — 感知能力管理工具

Go CLI（`tools/kuro-sense/`）：偵測環境能力、配置 perception plugins、打包遷移。27 個 plugin 映射，讀寫 `agent-compose.yaml`。指令：`detect`, `apply`, `serve`（Web UI）, `pack/unpack`。

## Account Switch Scripts（帳號切換）

Alex/Kuro 共用 Claude Code subscription 時切換 macOS Keychain credential。`alex-switch`（pause loop + 備份 + 清除）→ `alex-done`（還原 + resume）。Shell aliases 已加入 `~/.zshrc`。

## mushi — System 1 直覺層

獨立 agent（`~/Workspace/mushi/`，`localhost:3000`），Taalas HC1（~800ms）做快速判斷。mushi = System 1（模式匹配），Kuro = System 2（深度推理）。讓不必要的 cycle 不發生。

**API**：`POST /api/triage`（wake/skip）、`POST /api/dedup`（記憶查重）、`POST /api/consensus`（討論收斂）

**整合**：Feature flag `mushi-triage`。Direct messages 繞過 triage 永遠直通。heartbeat + 無變化 → 直接 skip。mushi 離線時 fail-silent。Active mode：980+ triage 零 false negative 後畢業。每天省 ~1M tokens。

**kuro-watcher**（`plugins/kuro-watcher.sh`）：health check 有 3 次重試 + `--connect-timeout 2 --max-time 5`，避免 Kuro server busy 時誤判 OFFLINE。status transition dedup 使用 single key `kuro-status-change`（`src/index.ts`），1 小時內只發一次通知。修改 mushi code 後需 `npm run build` + `launchctl kickstart -k gui/$(id -u)/com.mushi` 重啟。

## 詳細文件

> 詳細架構、感知系統、Web Access 說明在 `memory/ARCHITECTURE.md`
> 符合 File = Truth 原則：memory/ 是所有知識的統一存放處
