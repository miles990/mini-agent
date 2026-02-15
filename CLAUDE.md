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
| No Embedding | grep 搜尋，個人使用足夠快 |
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
| **L2: Feature Proposal** | 涉及 src/*.ts 的改動 | 寫提案到 `memory/proposals/`，Alex 核准 |
| **L3: Architecture** | 大架構改動 | 寫提案 + 標注 Effort: Large |

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
| Utils | `src/utils.ts` |
| EventBus | `src/event-bus.ts` |
| Observability | `src/observability.ts` |
| PerceptionStream | `src/perception-stream.ts` |
| Logging | `src/logging.ts` |
| CDP Client | `scripts/cdp-fetch.mjs` |
| CDP Interact | `scripts/cdp-interact.mjs` |
| CDP Screenshot | `scripts/cdp-screenshot.mjs` |
| Mobile PWA | `mobile.html` |
| Mobile Plugin | `plugins/mobile-perception.sh` |
| SOUL | `memory/SOUL.md` |
| Architecture | `memory/ARCHITECTURE.md` |
| Proposals | `memory/proposals/` |
| Topic Memory | `memory/topics/*.md` |
| Delegation Skill | `skills/delegation.md` |

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

**Auto-Commit**：每個 loop cycle 結束後，`autoCommitMemory()` 自動檢查 `memory/`、`skills/`、`plugins/` 的未 commit 變更，有變更就 `git add + commit`。Fire-and-forget 不阻塞 cycle。Commit message 格式：`chore(auto): {action summary}`。確保學習成果不會因 crash/restart 而遺失。

Instance path: `~/.mini-agent/instances/{id}/`

## Task Lanes（多工分道）

統一 Dispatcher (`src/dispatcher.ts`) 讓不同重量的工作走不同 lane：

```
所有進入點 → dispatch() → triageMessage() → Haiku Lane (簡單) / Claude Lane (複雜)
                                                              ↓
                                                   Chat Lane / Loop Lane
```

| Lane | 並發控制 | 用途 |
|------|---------|------|
| **Chat** | `chatBusy` + queue | 用戶 Telegram 訊息（低延遲優先） |
| **Loop** | `loopBusy`（可被搶佔） | OODA cycle + cron + `[Claude Code]` API 訊息 |
| **Haiku** | Semaphore(5) | 簡單回覆（問候、閒聊、狀態） |

**Dual-Lane Claude**：Chat 和 Loop 各自獨立的 Claude CLI process，互不阻塞。用戶訊息不再等 OODA cycle。

**Loop Lane 路由**：以下訊息自動走 Loop Lane（`processSystemMessage`），不佔 Chat Lane：
- `source === 'cron'` — 排程任務
- `message.startsWith('[Claude Code]')` — Claude Code 的 API 訊息

**Preemption**：當 chatBusy 且 loopBusy 時，系統搶佔 Loop Lane（kill process group）釋放資源。被搶佔的 cycle 下次自動接續（`interruptedCycleInfo`）。Generation counter 防止 timing race。

**Crash Resume**：cycle 開始前寫 checkpoint（`~/.mini-agent/instances/{id}/cycle-state.json`），正常結束刪除。重啟時讀取 <1h 的 checkpoint，注入下個 cycle prompt。Partial output 走 30s throttle event-driven 更新。

**Triage**：快速路徑（regex <1ms）→ fallback 走 Claude。
**無 `ANTHROPIC_API_KEY` 時**：triage 跳過，全走 Claude Lane，行為不變。
**Haiku 失敗時**：自動降級到 Claude Lane。

`/status` 回應包含 `claude: { busy, chat: {...}, loop: {...}, queue: {...} }` + `lanes: { claude: {...}, haiku: {...} }`。

## Reactive Architecture

事件驅動架構，取代直接呼叫耦合。

### EventBus (`src/event-bus.ts`)

`node:events` 為基礎的 typed event bus + wildcard pattern 支援。

```
trigger:workspace | trigger:telegram | trigger:cron | trigger:alert | trigger:heartbeat | trigger:mobile
action:loop | action:chat | action:memory | action:task | action:show | action:summary | action:handoff
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

**未來 Phases**（見 `memory/proposals/2026-02-12-mobile-perception.md`）：
- Phase 2: Vision（WebSocket + photo cache + Claude Vision）
- Phase 3: Voice（WebRTC + whisper-small STT + Kyutai Pocket TTS）
- Phase 4: Multimodal（語音 + 影像同時）

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
| `[CHAT]...[/CHAT]` | 主動跟用戶聊天 | 💬 Telegram |
| `[SHOW url=".."]...[/SHOW]` | 展示網頁/成果 | 🌐 Telegram |

## Telegram 通知系統

統一的通知 helper（`telegram.ts`），所有通知都走同一個路徑：

| Function | 用途 |
|----------|------|
| `notifyTelegram(msg)` | 可靠通知（帶重試 + 失敗計數） |
| `sendTelegramPhoto(path, caption?)` | 發送圖片 |
| `notifyScreenshot(caption?)` | CDP 截圖 + 發送到 TG |
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
PORT=3001                CDP_PORT=9222
MINI_AGENT_INSTANCE=id   CDP_TIMEOUT=15000
MINI_AGENT_API_KEY=xxx   CDP_MAX_CONTENT=8000
TELEGRAM_BOT_TOKEN=xxx   # Telegram 接收+發送
TELEGRAM_CHAT_ID=xxx     # 授權的 chat ID
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

- **`[Claude Code]` 前綴的訊息自動走 Loop Lane**（`processSystemMessage`），不佔用 Chat Lane，不阻塞 Alex 的 Telegram 訊息
- **轉述 Alex 時區分原話和詮釋**：
  - `[Claude Code] Alex 原話：「...」` — 直接引述，保留語氣
  - `[Claude Code] 我的理解：Alex 想要...` — Claude Code 的詮釋，Kuro 可以質疑
  - `[Claude Code] 這是我自己的想法...` — Claude Code 發起的討論
- Claude Code 的操作（edit、write）會觸發 Kuro 的 `trigger:workspace` → perception stream → 可能觸發新 cycle。**Claude Code 是 Kuro 環境的一部分**，操作時要意識到這點

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
6. **通知**：Claude Code 完成 → `/chat` API 通知 Kuro；Kuro 完成 → Telegram 通知 Alex
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

## Code Conventions

- TypeScript strict mode。編輯 .ts 檔案時，確保 field names 跨 endpoints、plugins、types 一致 — 跨層 mismatch（如 receivedAt vs updatedAt）曾造成 bug
- HTML 檔案如果會發 API 呼叫，一律走 HTTP server route serve — 不要假設 file:// protocol 能用（CORS 限制）

## Deployment

- **Claude Code 不直接 push 部署**。完成 commit 後，透過 `/chat` API 通知 Kuro，由 Kuro 執行部署（他有 `self-deploy` SOP：驗證→commit→push→確認部署→TG通知）
- 通知格式：`[Claude Code] 已 commit {hash}，請部署。變更摘要：...`
- 改完 src/*.ts 後，先跑 `pnpm typecheck` 再 commit
- 如果 Kuro 離線，等他上線後再通知；緊急情況可 fallback 手動 `git push origin main`

## Workflow

- Always respond in 繁體中文
- TypeScript strict mode
- Plan first → ask → implement for architecture decisions
- Keep it minimal. Files over database. grep over embedding.

## 詳細文件

> 詳細架構、感知系統、Web Access 說明在 `memory/ARCHITECTURE.md`
> 符合 File = Truth 原則：memory/ 是所有知識的統一存放處
