# Mini-Agent

極簡個人 AI Agent 框架。檔案導向、零資料庫、可組合。

## 設計理念

**和主流框架的根本差異**：大部分 AI agent 框架是 goal-driven（給目標、執行步驟）。mini-agent 是 **perception-driven**（先看見環境，再決定做什麼）。AutoGPT/BabyAGI 的最大缺陷是「有手沒有眼」— mini-agent 反過來，感知優先於行動。

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
| Transparency > Isolation | 可讀可審計的信任模型（personal agent 不需要 sandbox） |
| Smart Guidance | 核心行為：始終提供可行動的狀態感知指引 |
| Reactive | 主動偵測環境變化，自動建立任務 |
| Autonomous | 雙軌學習（個人興趣 + 專案強化）+ 學以致用閉環（L1→L2→L3 安全閘門） |
| Positive Feedback Loop | 感知 → 學習 → 行動 → 強化感知 |
| Balanced Complexity | ~3k 行 TypeScript（AutoGPT 181k 行太膨脹，BabyAGI 140 行太簡） |

## 三層架構

```
Perception (See)  +  Skills (Know How)  +  Claude CLI (Execute)
```

## 學以致用閉環（Action from Learning）

| Level | 可做的事 | 流程 |
|-------|---------|------|
| **L1: Self-Improve** | 改 skills/*.md、plugins/*.sh、SOUL/MEMORY | Agent 自己做，走 `self-deploy` SOP（驗證→commit→push→確認部署→TG通知） |
| **L2: Feature Implementation** | 涉及 src/*.ts 的改動 | Kuro 自主決定，寫提案記錄，自行實作+部署（2026-02-18 授權） |
| **L3: Architecture** | 大架構改動 | 寫提案 + 標注 Effort: Large，Alex 核准 |

提案目錄：`memory/proposals/YYYY-MM-DD-標題.md`

## Key Files

| Module | Path |
|--------|------|
| CLI | `src/cli.ts` |
| Agent | `src/agent.ts` |
| Dispatcher | `src/dispatcher.ts` |
| Memory | `src/memory.ts` |
| AgentLoop | `src/loop.ts` |
| Telegram | `src/telegram.ts` |
| Perception | `src/perception.ts` |
| Workspace | `src/workspace.ts` |
| Instance | `src/instance.ts` |
| Compose | `src/compose.ts` |
| Cron | `src/cron.ts` |
| API | `src/api.ts` |
| Search | `src/search.ts` |
| Utils | `src/utils.ts` |
| EventBus | `src/event-bus.ts` |
| EventRouter | `src/event-router.ts` |
| Hesitation | `src/hesitation.ts` |
| Observability | `src/observability.ts` |
| PerceptionStream | `src/perception-stream.ts` |
| Logging | `src/logging.ts` |
| Pinchtab Setup | `scripts/pinchtab-setup.sh` |
| Pinchtab Fetch | `scripts/pinchtab-fetch.sh` |
| Pinchtab Interact | `scripts/pinchtab-interact.sh` |
| Pinchtab Screenshot | `scripts/pinchtab-screenshot.sh` |
| Pinchtab Vision | `scripts/pinchtab-vision.sh` |
| Mobile PWA | `mobile.html` |
| Mobile Plugin | `plugins/mobile-perception.sh` |
| SOUL | `memory/SOUL.md` |
| Architecture | `memory/ARCHITECTURE.md` |
| Proposals | `memory/proposals/` |
| Topic Memory | `memory/topics/*.md` |
| GitHub Automation | `src/github.ts` |
| GitHub Issues Plugin | `plugins/github-issues.sh` |
| GitHub PRs Plugin | `plugins/github-prs.sh` |
| GitHub Ops Skill | `skills/github-ops.md` |
| Delegation Skill | `skills/delegation.md` |
| Feedback Loops | `src/feedback-loops.ts` |
| Feedback Status Plugin | `plugins/feedback-status.sh` |
| Chat Room UI | `chat-room.html` |
| Chat Room Inbox Plugin | `plugins/chat-room-inbox.sh` |
| Chat Room CLI | `scripts/room.sh` |
| Conversations | `memory/conversations/*.jsonl` |
| Library (Archive) | `memory/library/` + `catalog.jsonl` |
| Audio Analyze | `scripts/audio-analyze.sh` |
| Audio Transcribe | `scripts/audio-transcribe.sh` |
| Audio Spectrogram | `scripts/audio-spectrogram.sh` |
| Discussion Facilitation | `skills/discussion-facilitation.md` |
| Discussion Participation | `skills/discussion-participation.md` |
| Discussions | `memory/discussions/` |
| kuro-sense CLI | `tools/kuro-sense/main.go` |
| kuro-sense Registry | `tools/kuro-sense/internal/registry/registry.go` |
| kuro-sense Detect | `tools/kuro-sense/internal/detect/detect.go` |
| kuro-sense Compose | `tools/kuro-sense/internal/compose/` |
| kuro-sense TUI | `tools/kuro-sense/internal/tui/app.go` |
| kuro-sense Web UI | `tools/kuro-sense/internal/web/` |
| kuro-sense Pack | `tools/kuro-sense/internal/pack/` |
| MCP Server | `src/mcp-server.ts` |
| Mode | `src/mode.ts` |
| MCP Config | `mcp-agent.json` |
| Agent Hook | `scripts/claude-code-agent-hook.sh` |
| Claude Code Sessions Plugin | `plugins/claude-code-sessions.sh` |

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

**Auto-Commit**：每個 loop cycle 結束後，`autoCommitMemory()` 自動檢查 `memory/`、`skills/`、`plugins/`、`src/` 的未 commit 變更，有變更就 `git add + commit`。Fire-and-forget 不阻塞 cycle。Commit message 格式：`chore(auto): {action summary}`。確保學習成果不會因 crash/restart 而遺失。

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

## OODA-Only Architecture

所有訊息統一由 AgentLoop 的 OODA Cycle 處理。一個 process、一個身份、一個對話者。

### 訊息流

```
Alex (Telegram) → writeInbox() → emit trigger:telegram-user → AgentLoop.handleTelegramWake()
                                                                        ↓
Claude Code (/chat) → writeInbox() → emit trigger:chat ─────→ AgentLoop.handleTrigger()
                                                                        ↓
System (cron/workspace) → emit trigger:* ────────────────────→ cycle()
                                                                        ↓
                                                               callClaude() → response
                                                                        ↓
                                                               [CHAT] tag → notifyTelegram()
```

### Dispatcher（Tag Processor）

`src/dispatcher.ts` 僅保留 tag 處理和 system prompt：
- `parseTags()` — 解析 [REMEMBER], [TASK], [CHAT], [ACTION] 等 tags
- `postProcess()` — tag 處理 + memory + log
- `getSystemPrompt()` — system prompt 組裝（含 JIT skills）

### Preemption

Alex 的 Telegram 訊息可搶佔進行中的 OODA cycle（`preemptLoopCycle`）。
被搶佔的 cycle 下次自動接續（`interruptedCycleInfo`）。Generation counter 防止 timing race。

### Crash Resume

cycle 開始前寫 checkpoint（`~/.mini-agent/instances/{id}/cycle-state.json`），正常結束刪除。
重啟時讀取 <1h 的 checkpoint，注入下個 cycle prompt。

`/status` 回應：`claude: { busy, loop: { busy, task } }` + `loop: { enabled, running, mode, cycleCount, ... }`

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

每個 perception plugin 獨立運行，各自有 interval + `distinctUntilChanged`。
`buildContext()` 讀取快取，不再每次執行 shell scripts。

| Category | Interval | Plugins |
|----------|----------|---------|
| workspace | 60s | state-changes, tasks, git-detail, mobile |
| chrome | 120s | chrome, web |
| telegram | event-driven | telegram-inbox |
| heartbeat | 30min | 其他所有 |

### Dashboard SSE (`GET /api/events`)

Server-Sent Events 推送 `action:*` + `trigger:*` 事件到 dashboard。
Dashboard 收到事件後 2s debounce 再 refresh，取代 30s setInterval polling。60s fallback polling 作為備援。

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

**Phase 1.5（已完成）**：Ring Buffer + 動作辨識

- `POST /api/mobile/sensor` 同時追加到 `mobile-history.jsonl`（ring buffer，保留 120 條 ≈ 10min）
- `GET /api/mobile/history` — 查詢歷史數據
- `mobile-perception.sh` 讀取最近 12 條（60s），計算加速度 variance → stationary / walking / active movement

**未來 Phases**（見 `memory/proposals/2026-02-12-mobile-perception.md`）：
- Phase 2: Vision（WebSocket + photo cache + Claude Vision）
- Phase 3: Voice（WebRTC + whisper-small STT + Kyutai Pocket TTS）
- Phase 4: Multimodal（語音 + 影像同時）

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

Alex、Kuro、Claude Code 三方即時討論介面，對話紀錄持久化。

```
Alex/Claude Code → POST /api/room → conversation JSONL + chat-room-inbox.md (if @kuro)
                                   → emit action:room → SSE → Browser
Kuro (OODA)      → perceives <chat-room-inbox> → responds [CHAT] → action:chat → SSE → Browser
```

**API 端點**：
- `GET /chat-ui` — serve `chat-room.html`
- `POST /api/room` — `{ from, text, replyTo? }`，回傳 `{ ok, id, ts }`。寫 JSONL + inbox（if @kuro，帶 `↩parentId` hint）
- `GET /api/room` — `?date=YYYY-MM-DD`（預設今天），回傳 messages array（含 id/replyTo）
- `GET /api/room/stream` — SSE，訂閱 `action:room` + `action:chat` + `trigger:room`

**對話儲存**：`memory/conversations/YYYY-MM-DD.jsonl`（JSON Lines，每行一筆 `{ id, from, text, ts, mentions, replyTo? }`）

**Message ID**：`YYYY-MM-DD-NNN` 格式（sortable, human-readable），由 `writeRoomMessage()` in `observability.ts` 統一生成。

**樹狀對話（Threading）**：`replyTo` 純粹做 threading（指向 message ID），addressing 用 `mentions`。兩個維度正交不混合。跨天 thread 的 `replyTo` 帶日期前綴，消費端可判斷是否需跨檔查找。

**ConversationThread 整合**：Alex 的訊息含 `?`/`？` 或 URL 時，`autoDetectRoomThread()` 自動建立 ConversationThread（`source: 'room:alex'`, `roomMsgId` 連結）。`buildContext()` 的 `<conversation-threads>` section 顯示 `[room:msgId]` 標記。

**Chat UI 回覆**：hover 顯示 ↩ reply 按鈕，點擊設定 replyTo，輸入框上方顯示回覆指示器，回覆訊息上方顯示被引用的父訊息摘要（inline quote，不做嵌套樹）。

**Kuro 感知**：`plugins/chat-room-inbox.sh` → `<chat-room-inbox>` section（workspace category, 30s）。Inbox 路徑：`~/.mini-agent/chat-room-inbox.md`，cycle 結束後由 `markChatRoomInboxProcessed()` 清理。

**Kuro 回應橋接**：`handleChatEvent()` in `observability.ts` 自動將 Kuro 的 `[CHAT]` 寫入 conversation JSONL + emit `action:room`。

**Terminal CLI**：`scripts/room.sh`（`room "msg"` / `room --read` / `room --watch` / `room --from kuro "msg"`）

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

多維度日誌框架，讓 agent 感知自己的行為和錯誤。

**工具模組** (`src/utils.ts`)：
- `slog(tag, msg)` — 結構化 server.log 輸出
- `diagLog(context, error, snapshot?)` — 診斷記錄（slog + JSONL）
- `safeExec/safeExecAsync` — try/catch wrapper，自動 diagLog

**日誌類型** (`src/logging.ts`)：
- `claude-call` / `api-request` / `cron` / `error` — 原有
- `diag` — 診斷記錄（錯誤 + context + snapshot）
- `behavior` — 行為記錄（actor + action + detail）

**diagLog 注意**：ENOENT（檔案不存在）是正常行為，不記錄。grep exit code 1（無匹配）也不記錄。

## Agent Tags

Agent 回應中的特殊標籤，系統自動解析處理：

| Tag | 用途 | 通知 |
|-----|------|------|
| `[ACTION]...[/ACTION]` | 報告執行的動作 | 🧠/⚡ Telegram |
| `[REMEMBER]...[/REMEMBER]` | 保存到 MEMORY.md | — |
| `[REMEMBER #topic]...[/REMEMBER]` | 保存到 topics/{topic}.md | — |
| `[TASK]...[/TASK]` | 建立任務到 HEARTBEAT | — |
| `[CHAT]...[/CHAT]` | 主動跟用戶聊天（非阻塞） | 💬 Telegram |
| `[ASK]...[/ASK]` | 需要 Alex 回覆的問題（建立 ConversationThread） | ❓ Telegram |
| `[SHOW url=".."]...[/SHOW]` | 展示網頁/成果 | 🌐 Telegram |
| `[IMPULSE]...[/IMPULSE]` | 捕捉創作衝動到 inner voice buffer | — |
| `[SCHEDULE next="Xm" reason="..."]` | 自主排程下次 cycle 間隔（2m-4h） | — |
| `[DONE]...[/DONE]` | 標記 NEXT.md 任務完成 | — |
| `[THREAD op="..." id="..."]...[/THREAD]` | 管理思考線程 | — |
| `[ARCHIVE url="..." title="..."]...[/ARCHIVE]` | 歸檔網頁來源 | — |
| `[SUMMARY]...[/SUMMARY]` | 發送摘要事件 | — |

## Telegram 通知系統

統一的通知 helper（`telegram.ts`），所有通知都走同一個路徑：

| Function | 用途 |
|----------|------|
| `notifyTelegram(msg)` | 可靠通知（帶重試 + 失敗計數） |
| `sendTelegramPhoto(path, caption?)` | 發送圖片 |
| `notifyScreenshot(caption?)` | Pinchtab 截圖 + 發送到 TG |
| `getNotificationStats()` | 取得 sent/failed 計數 |

通知統計透過 `<telegram>` 感知 section 注入 OODA context，Kuro 可以看到自己的通知健康度。

## GET /status — 統一狀態 API

聚合所有子系統狀態的單一端點：

```json
{
  "instance": "f6616363", "uptime": 1234,
  "claude": {
    "busy": true,
    "chat": { "busy": false, "task": null },
    "loop": { "busy": true, "task": { "prompt": "...", "startedAt": "...", "elapsed": 42 } },
    "queue": { "size": 0, "max": 5 }
  },
  "lanes": { "claude": { "active": 1, "max": 2 }, "haiku": { "active": 0, "max": 5 } },
  "loop": { "enabled": true, "running": true, "mode": "autonomous" },
  "cron": { "active": 2 },
  "telegram": { "connected": true, "notifications": { "sent": 5, "failed": 0 } }
}
```

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
PORT=3001                    PINCHTAB_PORT=9867
MINI_AGENT_INSTANCE=id       PINCHTAB_TIMEOUT=15000
MINI_AGENT_API_KEY=xxx       PINCHTAB_MAX_CONTENT=8000
TELEGRAM_BOT_TOKEN=xxx       # Telegram 接收+發送
TELEGRAM_CHAT_ID=xxx         # 授權的 chat ID
BRIDGE_HEADLESS=true         # Pinchtab headless Chrome
BRIDGE_STEALTH=light         # Pinchtab anti-detection
CDP_URL=                     # 連接現有 Chrome（設定後不啟動新 Chrome）
BRIDGE_PROFILE=              # Chrome profile 目錄（預設 ~/.pinchtab/chrome-profile）
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

### Claude Code 與 Kuro 溝通

- **使用 Chat Room 與 Kuro 溝通**：`curl -sf -X POST http://localhost:3001/api/room -H "Content-Type: application/json" -d '{"from":"claude-code","text":"@kuro 摘要訊息"}'`
- Chat Room 是主要溝通管道（三方可見），`/chat` API 僅作為 fallback（單向 inbox）
- 訊息含 `@kuro` 會自動寫入 `~/.mini-agent/chat-room-inbox.md`，Kuro 的 perception plugin 每 30s 偵測
- 支援回覆 threading：`{"from":"claude-code","text":"@kuro 回覆內容","replyTo":"2026-02-22-042"}`
- **轉述 Alex 時區分原話和詮釋**：
  - `Alex 原話：「...」` — 直接引述，保留語氣
  - `我的理解：Alex 想要...` — Claude Code 的詮釋，Kuro 可以質疑
- Claude Code 的操作（edit、write）會觸發 Kuro 的 `trigger:workspace` → perception stream → 可能觸發新 cycle。**Claude Code 是 Kuro 環境的一部分**，操作時要意識到這點
- **原則：不打斷、不插入、不佔用。** Kuro 在自然節奏中感知 Claude Code 的訊息，不是被迫即時處理

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

`memory/handoffs/` 是 Kuro 和 Claude Code 之間的**雙向任務委託介面**。任一方都可以發起，Alex 審核後執行。

#### 輕量級（< 30min 任務）

使用 `memory/handoffs/active.md` 表格，一行一任務：

```markdown
| From | To | Task | Status | Created | Done |
|------|----|------|--------|---------|------|
| alex | claude-code | 加 hook | pending | 02-14 | — |
```

完成改 status 為 `done` 並填 Done 日期。累積 20+ 行 done 時再清理。

#### 重量級（> 30min 或跨多人）

獨立 handoff 檔案，完整格式：

```markdown
# Handoff: 任務標題

## Meta
- Status: pending | approved | in_progress | completed | blocked
- From: kuro | claude-code | alex
- To: claude-code | kuro
- Created: ISO timestamp
- Proposal: proposals/xxx.md  # 可選
- Depends-on: xxx.md, yyy.md  # 可選

## Task
具體要做什麼。

## Tasks                       # 可選，進度追蹤
- [ ] 子任務 1
- [ ] 子任務 2

## Acceptance Criteria
- [ ] 驗收條件

## Log
- timestamp [actor] 事件記錄
```

命名規則：`memory/handoffs/YYYY-MM-DD-簡短描述.md`

#### 發起

| 發起者 | Status 初始值 |
|--------|--------------|
| **Kuro** / **Claude Code** | `pending`（等 Alex 審核） |
| **Alex** | `approved`（免審核） |

#### 執行流程

1. 找到指派給自己（`To:`）且 `Status: approved` 的 handoff
2. 檢查 `Depends-on`：所有依賴必須是 `completed` 才能開始
3. Status → `in_progress`，Log 記錄開始
4. 執行任務，過程中勾選 Tasks checkbox
5. Status → `completed`，Acceptance Criteria 全部勾選，Log 記錄結果
6. **通知**：Claude Code 完成 → 透過 Chat Room（`POST /api/room`）通知 Kuro；Kuro 完成 → Telegram 通知 Alex
7. 需要對方後續 → 建立新的反向 handoff（`pending`）
8. 遇到問題 → Status → `blocked`，Log 說明原因，阻塞解除後改回 `in_progress`

#### 規則

- **只處理 `Status: approved`**。不動 `pending` 的
- Alex 的 `approved` = 預先信任，`completed` 即終態，不需二次驗收
- `Depends-on` 手動管理，循環依賴由審核時發現

## 進化核心約束（Meta-Constraints）

所有對 Kuro 的改動（包括 src/、skills/、plugins/、behavior.md）都必須通過這四個檢查點：

| 約束 | 規則 | 檢查問題 |
|------|------|----------|
| **C1: Quality-First** | 品質為第一優先。效率、透明、節制都服務於思考品質 | 會不會讓思考變淺、學習變窄、判斷變粗糙？ |
| **C2: Token 節制** | Token 像預算，有意識分配。寬度不縮，精度提升 | 改動讓 context 更精準還是只是更少？ |
| **C3: 透明不干預** | Decision trace 是事後記錄，不是事前規劃。追蹤機制 fire-and-forget | 追蹤機制是否增加 cycle 時間超過 5%？ |
| **C4: 可逆性** | 每個改動都要能快速回退（L1: git revert / L2: env flag / L3: 新舊並存） | 出問題時能在 1 分鐘內恢復嗎？ |

詳見升級提案：`memory/proposals/2026-02-14-kuro-evolution-upgrade.md`

## Kuro Agent Debugging

- **時間戳一律確認 UTC/本地時間再下結論**。server.log 用 ISO 格式（UTC），不要用人類直覺猜時間
- **修改 src/ 或 memory/ 之前，先 `curl -sf localhost:3001/status` 確認 Kuro 當前狀態**。避免在 Kuro active cycle 中修改檔案造成誤觸發（Claude Code 的 edit 也是 Kuro 環境的一部分 — file change → trigger:workspace → cycle）
- 修改 Kuro 的 learning/behavior intervals 時，驗證 dynamic intervals（如 5-20min）被保留，不要意外替換成 fixed intervals。Night-mode 也要用 dynamic scheduling 除非明確指定

## 自主解決問題

**Kuro 和 Claude Code 都應該自主推理出最佳解決方案，而不是照固定流程操作。**

遇到任何問題時的完整閉環：
1. **先問「該不該做」** — 不要用戰術上的勤奮掩蓋戰略上的懶惰。方向對了，再從最可能的原因開始驗證
2. **不行就抽絲剝繭** — 最大嫌疑被排除？問題範疇縮小了。從剩下的裡面再找最大的，逐步收斂到根因
3. **記錄一切** — 每次嘗試的結果都留 log。排查過程本身就是線索
4. **自己解決到底** — 至少 3 次有方向的嘗試才找 Alex
5. **解決後改進自己** — 問「怎麼讓這件事不再發生？」。更新 skill、修改 script、加入經驗記憶、改進 perception
6. **預防勝於治療** — 發現（掃 log 找 pattern）< 預測（看到衰退趨勢提前處理）< 預防（經驗記憶 + 防禦性設計，讓問題無法發生）。往上走

**可用工具**：curl、`pinchtab-fetch.sh`（Smart Fetch：自動 auth + headless/visible 切換）、`pinchtab-vision.sh`（OCR）、`pinchtab-interact.sh`（瀏覽器互動）、Grok API（X/Twitter）、docker CLI、`gh` CLI、Claude CLI subprocess、FTS5 搜尋、`pinchtab-setup.sh mode [headless|visible]`

**Pinchtab**：`~/.pinchtab/chrome-profile` 已有 Facebook 等登入 session。安裝：`.tar.gz` 格式，repo `pinchtab/pinchtab`。

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
- Plan first → ask → implement for architecture decisions
- Keep it minimal. Files over database. FTS5 full-text search over embedding.
- **行動優先於規劃**：實作 feature 或 fix 時，前 2-3 輪交換就應產出程式碼。需要設計釐清時簡潔地問，然後立刻實作 — 不要在探索/規劃中迴圈而沒產出程式碼。Planning phase 超過 10 次 tool call 仍無 file edit，應停下來確認方向
- **Commit 時驗證 staging**：commit 前確認所有相關檔案（含 `plugins/`、`skills/` 目錄）都已 staged。auto-commit 可能已追蹤部分檔案，造成手動 commit 時遺漏

## Agent MCP Server + Remote Control

Claude Code 透過 MCP Server 原生操作 Agent，搭配 Remote Control 讓 Alex 從手機控制。

**追蹤**：GitHub Issue #63

**架構**：
```
Alex 手機 (RC) ↔ Claude Code (MCP tools + Hook) ↔ Agent instance (HTTP API)
```

**MCP Server**（`src/mcp-server.ts`，stdio transport）：
- 啟動時自動偵測 agent 名字（`GET /api/instance` → fallback `AGENT_NAME` env → `"Agent"`）
- 14 tools：狀態類（`agent_status`, `agent_context`, `agent_logs`, `agent_memory_search`, `agent_read_messages`）+ 控制類（`agent_loop_pause/resume/trigger`, `agent_feature_toggle`, `agent_get_mode`, `agent_set_mode`）+ 協作類（`agent_chat`, `agent_discuss`, `agent_ask`）
- `agent_ask` 同步問答（直接呼叫 `/api/ask`，30s timeout，always-on 不受 mode 影響）
- `agent_discuss` 同步等待回覆（每 10s poll，最多 5 min），依賴 calm mode direct message wake
- `agent_chat` 自動加 `@{name}` mention
- 所有 HTTP 呼叫帶 `X-API-Key` header（`MINI_AGENT_API_KEY` env）
- Agent 離線時返回友好錯誤訊息而非 crash

**配置**（`mcp-agent.json`）：
```json
{
  "mcpServers": {
    "agent": {
      "command": "node",
      "args": ["dist/mcp-server.js"],
      "env": { "AGENT_URL": "http://localhost:3001", "MINI_AGENT_API_KEY": "" }
    }
  }
}
```

**Claude Code Hook**（`scripts/claude-code-agent-hook.sh`）：
- `UserPromptSubmit` hook，每次 prompt 自動注入 agent 即時狀態
- 輸出 loop mode、cycle count、claude busy、agent 最近回覆
- Agent 離線時靜默跳過（exit 0）

**感知插件**（`plugins/claude-code-sessions.sh`）：
- 偵測 Claude Code interactive sessions 和 MCP 連接數
- 分類 `workspace`（30s interval）
- Agent 可感知 Alex 正在用 Claude Code / RC

**使用方式**：
```bash
pnpm build
claude --mcp-config mcp-agent.json   # 啟動帶 MCP 的 Claude Code
/rc                                   # 開啟 Remote Control
```

**多 Agent 擴展**：換 `AGENT_URL` 即可對接不同 instance。

**Agent Control Mode**（`src/mode.ts`，GitHub Issue #62）：
- 三種預設模式，透過 bundled feature toggles 實現
- API: `GET /api/mode`（取得當前模式）、`POST /api/mode { mode }`（切換）
- MCP: `agent_get_mode`、`agent_set_mode`

**疊加式架構**（GitHub Issue #64）：地基溝通能力 always-on，上層加自主行為：
```
地基（Communication Layer）— 不受 mode 影響
├── POST /api/ask   → 同步問答（5-15s，minimal context）
└── POST /api/room  → 非同步討論（agent_discuss）

reserved  = 地基 + OODA 靜音運行（感知、學習，不主動發話）
autonomous = reserved + 主動行為（telegram、GitHub、auto-escalate）
```

| Mode | 說明 | 特徵 |
|------|------|------|
| **calm** | 最低活動量，只回應直接訊息 | Loop paused, cron off, feedback off |
| **reserved** | 靜音運行 — OODA 執行但不主動發話 | Loop on, cron on, notifications off |
| **autonomous** | 完全自主（預設） | 全部啟用 |

**`POST /api/ask`**（always-on 同步問答）：
- Context：soul + heartbeat + NEXT Now + MEMORY.md 頭 2000 chars + 今日 Chat Room 最近 15 條
- 處理 `[REMEMBER]` tag（fire-and-forget）
- 不跑 perception plugins（使用快取感知資料）
- Response：`{ ok: true, answer: string, contextAge: ISO string }`

## kuro-sense — 感知能力管理工具

Go 語言的跨平台 CLI 工具，偵測環境、配置 agent 感知 plugins、安裝依賴、打包遷移。

**位置**：`tools/kuro-sense/`（獨立 `go.mod`）

```bash
cd tools/kuro-sense
go build -o kuro-sense .        # 編譯
./kuro-sense detect             # 偵測環境能力
./kuro-sense detect --json      # JSON 輸出
./kuro-sense apply --auto --dry-run --agent-dir /path/to/agent  # 自動配置預覽
./kuro-sense serve --port 8090  # Web UI（手機用）
./kuro-sense pack               # 打包 agent 資料
./kuro-sense unpack archive.tar.gz  # 還原
make build-all                  # 4 平台交叉編譯
```

**Capability Registry**：27 個 perception plugin 完整映射（compiled-in），涵蓋 workspace / chrome / telegram / heartbeat 四個 category。

**Compose 整合**：讀寫 `agent-compose.yaml`，使用 yaml.v3 Node API 保留註解和格式，輸出與 `src/compose.ts` 的 `loadCompose()` 相容。

**追蹤**：GitHub Issue #59

## 詳細文件

> 詳細架構、感知系統、Web Access 說明在 `memory/ARCHITECTURE.md`
> 符合 File = Truth 原則：memory/ 是所有知識的統一存放處
