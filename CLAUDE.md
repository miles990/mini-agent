# Mini-Agent

極簡個人 AI Agent 框架。檔案導向、零資料庫、可組合。

## 核心原則

| 原則 | 說明 |
|------|------|
| No Database | Markdown + JSON Lines，人類可讀，Git 可版控 |
| No Embedding | grep 搜尋，個人使用足夠快 |
| File = Truth | 檔案是唯一真相來源 |
| Identity-Driven | SOUL.md 定義 Agent 身份、興趣、觀點 |
| Perception-First | 環境驅動行動，非目標驅動 |
| Transparency > Isolation | 可讀可審計的信任模型 |
| Smart Guidance | 核心行為：始終提供可行動的狀態感知指引 |
| Reactive | 主動偵測環境變化，自動建立任務 |
| Autonomous | 雙軌學習（個人興趣 + 專案強化）+ 學以致用閉環 |
| Positive Feedback Loop | 感知 → 學習 → 行動 → 強化感知 |

## 三層架構

```
Perception (See)  +  Skills (Know How)  +  Claude CLI (Execute)
```

## 學以致用閉環（Action from Learning）

| Level | 可做的事 | 流程 |
|-------|---------|------|
| **L1: Self-Improve** | 改 skills/*.md、plugins/*.sh、SOUL/MEMORY | Agent 自己做，事後通知 |
| **L2: Feature Proposal** | 涉及 src/*.ts 的改動 | 寫提案到 `memory/proposals/`，Alex 核准 |
| **L3: Architecture** | 大架構改動 | 寫提案 + 標注 Effort: Large |

提案目錄：`memory/proposals/YYYY-MM-DD-標題.md`

## Key Files

| Module | Path |
|--------|------|
| CLI | `src/cli.ts` |
| Agent | `src/agent.ts` |
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
| SOUL | `memory/SOUL.md` |
| Architecture | `memory/ARCHITECTURE.md` |
| Proposals | `memory/proposals/` |

## Memory Architecture

```
Hot  (In-Memory)  → Last 20 conversations
Warm (Daily File) → daily/YYYY-MM-DD.md
Cold (Long-term)  → MEMORY.md + HEARTBEAT.md + SOUL.md + proposals/
```

Instance path: `~/.mini-agent/instances/{id}/`

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
| `memory.save` | `[REMEMBER]` 記憶保存 |
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
| `[REMEMBER]...[/REMEMBER]` | 保存到記憶 | — |
| `[TASK]...[/TASK]` | 建立任務到 HEARTBEAT | — |
| `[CHAT]...[/CHAT]` | 主動跟用戶聊天 | 💬 Telegram |
| `[SHOW url=".."]...[/SHOW]` | 展示網頁/成果 | 🌐 Telegram |

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

## Workflow

- Always respond in 繁體中文
- TypeScript strict mode
- Plan first → ask → implement for architecture decisions
- Keep it minimal. Files over database. grep over embedding.

## 詳細文件

> 詳細架構、感知系統、Web Access 說明在 `memory/ARCHITECTURE.md`
> 符合 File = Truth 原則：memory/ 是所有知識的統一存放處
