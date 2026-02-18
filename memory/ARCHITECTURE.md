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

現有 (12): chrome-status / web-fetch / docker-status / port-check / task-tracker / state-watcher / telegram-inbox / disk-usage / git-status / homebrew-outdated / self-awareness / website-monitor

### Skills (Markdown Knowledge)

Markdown 檔案注入 system prompt (`## Your Skills`)

現有 (11): autonomous-behavior / web-research / web-learning / action-from-learning / docker-ops / debug-helper / project-manager / code-review / server-admin / self-deploy / verified-development

已合併清理 (2026-02-11): reactive-agent → autonomous-behavior (ALERT 回應表 + 巡檢順序), action-reporting → autonomous-behavior (ACTION 結構表 + 規模判斷)。

## Web Access (Three-Layer)

1. **curl** — 公開頁面、API（快速 <3s）
2. **Chrome CDP** — 使用者已登入的 session（port 9222）
3. **Open page** — 可見 tab 讓使用者登入/驗證

Key files:
- `scripts/cdp-fetch.mjs` — 零依賴 CDP client（commands: status/fetch/open/extract/close）
- `scripts/cdp-interact.mjs` — 瀏覽器互動（click/type/fill-form/screenshot/eval/wait/list-inputs）
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

## JIT Loading Pattern（按需載入）

Agent 知識管理的核心模式：不把所有知識塞進 context，按需載入。

```
大知識庫 → Index/Matching → 載入相關子集 → Context Window
```

mini-agent 的實踐：

| 層級 | 機制 | 觸發方式 |
|------|------|----------|
| Topic Memory | `memory/topics/*.md` | `buildContext()` 關鍵字匹配 |
| Skills | `skills/*.md` | System prompt 靜態注入 |
| Perception Cache | `perception-stream.ts` | 各 plugin 獨立 interval + distinctUntilChanged |

業界同構實踐（2026-02 研究）：
- **CodeRLM** — Tree-sitter 結構化索引 + API 查詢（symbol-level, index-backed）
- **Teddy Chen Pattern Language** — 3 萬行 skill 用內部 JIT Loading（集中知識、按需載入、統一治理）
- **RLM 論文** (MIT CSAIL) — 把大資料當外部資料，遞迴查詢而非全量載入

**設計取捨**：mini-agent 用關鍵字匹配（模糊但零依賴），CodeRLM 用 tree-sitter（精確但需要 Rust server）。個人 agent 3K 行 codebase，模糊匹配足夠。

## Learning-to-Action Loop

感知 → 學習 → 行動 → 強化感知（正向閉環）

| Level | 範圍 | 流程 |
|-------|------|------|
| L1: Self-Improve | skills/*.md, plugins/*.sh, SOUL/MEMORY | 自己做，事後通知 |
| L2: Feature Implementation | src/*.ts 改動 | Kuro 自主決定+實作，寫提案記錄（2026-02-18 授權） |
| L3: Architecture | 大架構改動 | 寫提案 + Effort: Large，需 Alex 核准 |

提案格式：`memory/proposals/YYYY-MM-DD-標題.md`（含 Problem, Goal, Alternatives, Pros & Cons）

## AgentLoop (OODA)

Observe → Orient → Decide → Act

支援：暫停/繼續、手動觸發、Cron 整合、Graceful Shutdown（SIGTERM → 停止所有服務 → 5s 強制退出）

## Multi-Instance (Docker-style)

```bash
mini-agent up [-d] / down / list / attach <id> / status / logs [-f]
```

每個實例隔離在 `~/.mini-agent/instances/{id}/`
