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
| Logging | `src/logging.ts` |
| CDP Client | `scripts/cdp-fetch.mjs` |
| CDP Interact | `scripts/cdp-interact.mjs` |
| CDP Screenshot | `scripts/cdp-screenshot.mjs` |
| SOUL | `memory/SOUL.md` |
| Architecture | `memory/ARCHITECTURE.md` |
| Proposals | `memory/proposals/` |
| Topic Memory | `memory/topics/*.md` |

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

Instance path: `~/.mini-agent/instances/{id}/`

## Task Lanes（多工分道）

統一 Dispatcher (`src/dispatcher.ts`) 讓不同重量的工作走不同 lane：

```
所有進入點 → dispatch() → triageMessage() → Haiku Lane (簡單) / Claude Lane (複雜)
```

| Lane | 並發控制 | 用途 |
|------|---------|------|
| **Claude** | `claudeBusy` + queue（既有） | 複雜任務（工具、程式碼、部署） |
| **Haiku** | Semaphore(5) | 簡單回覆（問候、閒聊、狀態） |

**Triage**：快速路徑（regex <1ms）→ 慢速路徑（Haiku API ~200ms）→ fallback 走 Claude。
**無 `ANTHROPIC_API_KEY` 時**：triage 跳過，全走 Claude Lane，行為不變。
**Haiku 失敗時**：自動降級到 Claude Lane。

`/status` 回應包含 `lanes: { claude: {...}, haiku: {...} }`。

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

**Behavior Log 覆蓋**：

| action | 觸發點 |
|--------|--------|
| `loop.cycle.start/end` | OODA 循環 |
| `action.autonomous/task` | `[ACTION]` 自主/任務行動 |
| `memory.save` | `[REMEMBER]` 記憶保存（MEMORY.md） |
| `memory.save.topic` | `[REMEMBER #topic]` topic 記憶保存 |
| `task.create` | `[TASK]` 建立任務 |
| `show.webpage` | `[SHOW]` 展示網頁 |
| `claude.call` | Claude CLI 呼叫 |
| `cron.trigger` | Cron 觸發 |
| `telegram.message/reply` | Telegram 收發訊息 |

**CDP 操作日誌**：`~/.mini-agent/cdp.jsonl`（fetch/open/extract/close）

**`<activity>` 感知**：診斷 + 行為 + CDP 操作，注入 OODA context。

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
  "claude": { "busy": true, "currentTask": { "prompt": "...", "elapsed": 42 }, "queue": { "size": 0, "max": 5 } },
  "lanes": { "claude": { "active": 1, "max": 1 }, "haiku": { "active": 0, "max": 5 } },
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

三者共同維護這個專案，各有不同角色：

| 角色 | 身份 | 職責 |
|------|------|------|
| **Alex** | 人類 | 決策、方向、核准 |
| **Claude Code** | 開發工具 | 寫程式、重構、部署、驗證 |
| **Kuro** | 自主 Agent | 感知環境、自主學習、執行任務、回報狀態 |

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

### Handoff Protocol v2（雙向任務委託 + 依賴追蹤）

`memory/handoffs/` 是 Kuro 和 Claude Code 之間的**雙向任務委託介面**。任一方都可以發起 handoff，Alex 審核後才能執行。

```bash
# 檢查是否有待處理的 handoff
ls memory/handoffs/*.md 2>/dev/null
```

#### Handoff 檔案格式

```markdown
# Handoff: 任務標題

## Meta
- Status: pending → approved → in_progress → completed → verified | blocked | rejected
- From: kuro | claude-code | alex
- To: claude-code | kuro
- Reviewer: alex              # 可選，預設 Alex
- Created: ISO timestamp
- Proposal: proposals/xxx.md  # 可選，關聯的 proposal
- Depends-on: xxx.md, yyy.md  # 可選，依賴的其他 handoff

## Task
具體要做什麼。

## Tasks                       # 可選，實作步驟追蹤
- [ ] 子任務 1
- [ ] 子任務 2

## Acceptance Criteria
- [ ] 驗收條件

## Log
- timestamp [actor] 事件記錄
```

#### 發起 Handoff

| 發起者 | 方式 | Status 初始值 |
|--------|------|--------------|
| **Kuro** | OODA loop 中發現需要 Claude Code 做 L2 改動，建立 handoff 檔案 | `pending` |
| **Claude Code** | 完成任務後需要 Kuro 驗證/整合，建立反向 handoff 檔案 | `pending` |
| **Alex** | 直接建立 handoff 指派任務給任一方 | `approved`（免審核） |

命名規則：`memory/handoffs/YYYY-MM-DD-簡短描述.md`

發起者建立檔案後，在 Log 記錄建立事件，等 Alex 把 Status 改為 `approved` 後才會被執行。

#### Claude Code 處理流程

1. 找到 `To: claude-code` 且 `Status: approved` 的 handoff
2. 檢查 `Depends-on`：所有依賴必須是 `Status: verified` 才能開始
3. 把 Status 改為 `in_progress`，Log 記錄開始時間
4. 參考關聯的 proposal 實作，過程中勾選 Tasks checkbox
5. 完成後把 Status 改為 `completed`，在 Log 記錄結果
6. 如果需要 Kuro 後續驗證/整合，建立反向 handoff（`From: claude-code, To: kuro`）
7. 如果遇到問題，把 Status 改為 `blocked`，在 Log 說明原因

#### Kuro 處理流程

1. 感知系統（`handoff-watcher.sh`）偵測到 `To: kuro` 且 `Status: approved` 的 handoff
2. 檢查 `Depends-on`：所有依賴必須是 `Status: verified` 才能開始
3. 把 Status 改為 `in_progress`，Log 記錄開始
4. 在 OODA loop 中執行任務（驗證、數據分析、反思、更新 SOUL.md 等）
5. 過程中勾選 Tasks checkbox 追蹤進度
6. 完成後把 Status 改為 `completed`，Log 記錄結果
7. 如果發現後續需要 Claude Code 做 L2 改動，建立新 handoff（`From: kuro, To: claude-code`）

#### 完成後處理

1. 執行者把 Status 改為 `completed`，確保 Acceptance Criteria 全部勾選
2. **通知對方**：
   - Claude Code 完成 → 透過 `/chat` API 通知 Kuro（Kuro 常駐，能即時收到）
   - Kuro 完成 → 透過 Telegram 通知 Alex（Claude Code 非常駐，等 Alex 下次啟動時檢查）
3. **Reviewer 驗收**：Reviewer（通常是 Alex）檢查 Acceptance Criteria，Status 改為 `verified`，Log 記錄簽收
4. **依賴解鎖**：`Depends-on` 指向這個 handoff 的其他任務，`verified` 後可以開始
5. **需要後續？** 建立新的反向 handoff（`pending`，等審核）
6. **不需要後續？** 檔案留原處，git history 即歸檔

```
completed ──Reviewer 驗收──→ verified ──→ 解鎖依賴 ──有後續──→ 新 handoff（pending）
                                              │
                                              └──無後續──→ 結束
```

#### Blocked 恢復

1. 執行者遇到問題，Status 改為 `blocked`，Log 說明阻塞原因
2. Kuro blocked → Telegram 通知 Alex；Claude Code blocked → Log 記錄，等 Alex 下次看到
3. 阻塞解除後（Alex 介入 / 依賴完成 / 問題修復），Status 改回 `in_progress`，Log 記錄恢復原因

#### 安全規則

- **只處理 `Status: approved` 的任務**（Alex 已審核）。不要處理 `draft` 或 `pending` 的
- Alex 發起的 handoff（`From: alex`）不需要額外 Reviewer
- `Depends-on` 是手動管理，循環依賴由審核時發現

## Workflow

- Always respond in 繁體中文
- TypeScript strict mode
- Plan first → ask → implement for architecture decisions
- Keep it minimal. Files over database. grep over embedding.

## 詳細文件

> 詳細架構、感知系統、Web Access 說明在 `memory/ARCHITECTURE.md`
> 符合 File = Truth 原則：memory/ 是所有知識的統一存放處
