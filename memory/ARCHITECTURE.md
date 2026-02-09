# Architecture Reference

> 詳細架構說明。Claude Code 開發和 Agent 運行時都能參考。

## Perception System

### Builtin Modules (8)

| Module | Tag | Data |
|--------|-----|------|
| Environment | `<environment>` | Time, timezone, instance ID |
| Self | `<self>` | Name, role, port, persona, loop/cron status |
| Process | `<process>` | Uptime, PID, memory, other instances, log stats |
| System | `<system>` | CPU, memory, disk, platform |
| Logs | `<logs>` | Recent errors, events summary |
| Network | `<network>` | Port status, service reachability |
| Config | `<config>` | Compose agents, global defaults |
| Workspace | `<workspace>` | File tree, git status, recent files |

### Custom Plugins (Shell Scripts)

任何可執行檔 → stdout → `<name>...</name>` XML tag → Claude context

```yaml
perception:
  custom:
    - name: docker
      script: ./plugins/docker-status.sh
      timeout: 5000
```

現有: chrome-status / web-fetch / docker-status / port-check / task-tracker / state-watcher / telegram-inbox / disk-usage / git-status / homebrew-outdated

### Skills (Markdown Knowledge)

Markdown 檔案注入 system prompt (`## Your Skills`)

現有: autonomous-behavior / reactive-agent / web-research / web-learning / action-from-learning / docker-ops / debug-helper / project-manager / code-review / server-admin

## Web Access (Three-Layer)

1. **curl** — 公開頁面、API（快速 <3s）
2. **Chrome CDP** — 使用者已登入的 session（port 9222）
3. **Open page** — 可見 tab 讓使用者登入/驗證

Key files:
- `scripts/cdp-fetch.mjs` — 零依賴 CDP client（commands: status/fetch/open/extract/close）
- `scripts/chrome-setup.sh` — 互動式設定
- `plugins/chrome-status.sh` — CDP 狀態 + smart guidance
- `plugins/web-fetch.sh` — 自動 URL 提取
- `skills/web-research.md` — 三層工作流知識

## Project Structure

```
./
├── agent-compose.yaml   # Compose 配置
├── plugins/             # Shell script 感知插件
├── skills/              # Markdown 知識模組
├── memory/              # 記憶（此檔案所在）
│   ├── MEMORY.md        # 長期知識
│   ├── HEARTBEAT.md     # 任務管理
│   ├── SOUL.md          # Agent 身份、興趣、觀點、競品研究
│   ├── ARCHITECTURE.md  # 架構參考（本檔案）
│   ├── proposals/       # 功能提案（Agent 提出，人類審核）
│   ├── research/        # 研究報告
│   ├── .telegram-inbox.md # Telegram 訊息收件匣
│   ├── media/           # Telegram 下載的媒體
│   └── daily/           # 每日對話日誌
├── scripts/             # 工具腳本
└── src/                 # TypeScript source
```

## Telegram Integration

雙向 Telegram 整合，使用 Bot API `getUpdates` 長輪詢（零新依賴）。

Key files:
- `src/telegram.ts` — TelegramPoller class（getUpdates + sendMessage + 檔案下載）
- `plugins/telegram-inbox.sh` — Perception 插件（讀取未處理訊息）
- `memory/.telegram-inbox.md` — Inbox 檔案（File=Truth）
- `memory/.telegram-offset` — 長輪詢 offset 持久化
- `memory/media/` — 下載的圖片/文件/語音

智能回覆：收到訊息後 buffer 3 秒，累積多條後一次處理回覆。
安全：只接受 `TELEGRAM_CHAT_ID` 的訊息。
Loop 整合：`loop.ts` 的 `notifyTelegram()` 改用 TelegramPoller.sendMessage()。

## Design Decisions (Why This Architecture)

> 基於 6 個競品研究（AutoGPT, BabyAGI, Aider, Open Interpreter, LocalGPT, Matchlock）的驗證結論。

| 決策 | 選擇 | 驗證來源 |
|------|------|----------|
| **Perception-First** | 環境驅動行動，非目標驅動 | AutoGPT/BabyAGI 的最大缺陷就是「有手沒有眼」 |
| **File=Truth** | Markdown + JSONL，零資料庫 | AutoGPT 在 2023 年底移除所有 vector DB（Pinecone/Milvus/Redis/Weaviate） |
| **grep > embedding** | 文字搜尋優先 | 個人 agent 的資料量不需要 vector search |
| **Identity > Logs** | SOUL.md 定義「我是誰」 | BabyAGI 的 embedding 記憶不可讀、不可審計 |
| **Transparency > Isolation** | 可讀可審計的信任模型 | Matchlock sandbox 適合多租戶，personal agent 用透明性 |
| **Balanced Complexity** | ~3k lines TypeScript | AutoGPT 膨脹到 181k lines，BabyAGI 140 lines 太簡 |

詳細研究報告：`memory/research/`

## Learning-to-Action Loop

感知 → 學習 → 行動 → 強化感知（正向閉環）

| Level | 範圍 | 流程 |
|-------|------|------|
| L1: Self-Improve | skills/*.md, plugins/*.sh, SOUL/MEMORY | 自己做，事後通知 |
| L2: Feature Proposal | src/*.ts 改動 | 寫提案到 proposals/，需人類核准 |
| L3: Architecture | 大架構改動 | 寫提案 + Effort: Large |

提案格式：`memory/proposals/YYYY-MM-DD-標題.md`（含 Problem, Goal, Alternatives, Pros & Cons）

## AgentLoop (OODA)

Observe → Orient → Decide → Act

支援：暫停/繼續、手動觸發、Cron 整合、Graceful Shutdown（SIGTERM → 停止所有服務 → 5s 強制退出）

## Multi-Instance (Docker-style)

```bash
mini-agent up [-d] / down / list / attach <id> / status / logs [-f]
```

每個實例隔離在 `~/.mini-agent/instances/{id}/`
