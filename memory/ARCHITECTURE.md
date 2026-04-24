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

### Design Principle: Plugins as Attention Selectors

每個 perception plugin 不只是資料收集器 — 它是**注意力選擇器**，決定該 cycle 可以有什麼樣的思維方式。不同 plugin 啟動不同類型的注意力：

| Plugin | Attention Type | 思維效果 |
|--------|---------------|---------|
| chrome | exploratory | 跟隨好奇心，發現新方向 |
| state-changes | alert | 偵測異常，快速回應 |
| self-awareness | metacognitive | 觀察自己的模式，校準行為 |
| telegram-inbox | relational | 回應他人，維護關係 |
| inner-voice | reflective | 重新咀嚼，形成新連結 |

設計含義：少而精的 plugins（每個精準塑造特定注意力類型）比多而雜更好。同時追求所有注意力類型 = 沒有一種做得好。OODA cycle 在不同 plugin 間交替 = 注意力類型交替。

參考：Burnett "Cybernetic Attention" (PDR 2026-01-21)、McGilchrist attention-as-love、BotW 3 規則原則。

### Skills (Markdown Knowledge)

Markdown 檔案注入 system prompt (`## Your Skills`)

現有 (11): autonomous-behavior / web-research / web-learning / action-from-learning / docker-ops / debug-helper / project-manager / code-review / server-admin / self-deploy / verified-development

已合併清理 (2026-02-11): reactive-agent → autonomous-behavior (ALERT 回應表 + 巡檢順序), action-reporting → autonomous-behavior (ACTION 結構表 + 規模判斷)。

## Web Access (Multi-Layer)

0. **Grok API** — X/Twitter 專用，影片理解（`enable_video_understanding`）
1. **curl** — 公開頁面、API（快速 <3s）
2. **Jina Reader** — JS-heavy 公開頁面（Markdown 輸出）
3. **Chrome CDP** — 使用者已登入的 Chrome session（port 9222，直連）
4. **Open page** — 可見 tab 讓使用者登入/驗證

Key files:
- `scripts/cdp-fetch.mjs` — Chrome CDP 客戶端（fetch/screenshot/interact/login）
- `plugins/chrome-status.sh` — Chrome CDP 狀態
- `plugins/web-fetch.sh` — 五層自動 URL 擷取（curl → Jina → Grok → CDP → manual）
- `skills/web-research.md` — 多層工作流知識

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

## mushi — System 1 Triage Layer

獨立輕量級 agent，用 Taalas HC1（硬體化 Llama 3.1 8B）作為 Kuro 的 pre-attentive filtering 層。

### 設計原理

Kahneman 雙系統的延伸 — 實際上是三層：

| Layer | 對應 | 延遲 | 成本 |
|-------|------|------|------|
| 硬規則（direct message → always wake） | Pre-attentive | 0ms | $0 |
| HC1 LLM triage（skip/quick/wake） | System 1 | ~700-1200ms | $0（本地硬體） |
| Claude OODA cycle | System 2 | ~30-60s | ~50K tokens/cycle |

核心價值：不是讓 cycle 更快，是讓不必要的 cycle 不發生。

### Production Data（verified）

6.9h session（2026-03-05 live endpoint）：

- **3416 senses**（環境感知），**77 thinks**（LLM 判斷），**2 escalations**
- Triage 分佈：~55-59% skip / ~20% quick / ~24% wake
- Rule-based ~30%（0ms），LLM ~70%（avg 700-1200ms）
- 保守 token 節省估算：~5.5M tokens/day
- False negative rate: 0%（direct messages 硬規則繞過 triage）

### 三層注意力的認知科學對應

skip/quick/wake 對應認知科學三層模型：Broadbent 過濾（pre-attentive filter）→ Treisman 衰減（attenuated processing）→ System 2（full engagement）。Log 顯示層間動態切換：LLM triage 後 rule 用 cooldown 接管，冷卻後 LLM 重新介入 — 類似注意力不應期（attentional refractory period）。

### 競品定位

最接近競品：DPT-Agent（SJTU-MARL, arXiv:2502.11882）— FSM+code-as-policy 做 S1，Theory-of-Mind 做 S2。差異：mushi 用 LLM-to-LLM 路由（更簡潔），DPT-Agent 用非 LLM 確定性控制層（更可控）。其他成本削減方法（semantic caching ~73%、AgentDiet trajectory 39-59%）需要額外 overhead，mushi 直接跳過整個 cycle = 線性成本節省。

### 架構

```
Trigger 事件 → mushi triage（~800ms, HC1）→ skip: 省整個 OODA cycle
                                            → quick: 輕量回應（~5K tokens）
                                            → wake: 完整 Claude cycle（~50K tokens）
```

API: `POST /api/triage`（分類）、`POST /api/dedup`（重複偵測）、`POST /api/consensus`（收斂偵測）、`GET /health`

Server: `~/Workspace/mushi/`（獨立 repo，獨立部署，localhost:3000）

## buildContext Sections

`buildContext` assembles the perception payload for each OODA cycle by stitching named sections (each rendered into a `<section>...</section>` block in the prompt). Sections are not equal — a 7-day baseline (3,295 samples, 2026-04-17→04-23) shows the top-7 sections account for ~26.7K chars of mean cycle context vs ~31K for the next 17 sections combined. Section list and tier policy below.

**T1 HOT** (mean ≥3000 chars — render every cycle, prune content not section):
- `reasoning-continuity` (4968) — last cycle's chosen/skipped/saved trio; load-bearing for thought continuity
- `task-queue` (4423, vol 1.27) — pending+in_progress unified queue
- `web-fetch-results` (3971) — bounded buffer, naturally rare
- `heartbeat` (3848, vol **66.71** — outlier max 258K) — needs hard cap, single biggest blast radius
- `chat-room-recent` (3281, vol 3.24) — Alex/CC dialog tail
- `middleware-workers` (3085) — worker registry for delegation routing
- `memory` (3084, vol 1.10) — MEMORY.md slice (Learned Patterns terminal section)

**T2 WARM** (1000–3000 chars — render with budget cap, drop least-recently-relevant):
17 sections including `heartbeat-active`, `chat-room-inbox`, `next`, `soul`, `soul-core`, `workspace`, `self-awareness`, `myelin-framework`, `memory-index`, `threads`, `knowledge-graph`, `recent_conversations`, `capabilities`, `activity`, `self`, `logs`, `tasks`.

**T3 COLD** (<1000 chars — render on-demand or behind a flag):
~50 sections including `action-memory`, `temporal`, `kuro:*` family, `claude-code-inbox`, `pinned-tasks`, `topic-memory`, `pulse`, structural/diagnostic markers, etc.

**Volatility outliers** (mean modest but max >>p95 — investigate or cap independently):
- `heartbeat` max 258246 (mean 3848) — runaway HEARTBEAT.md inclusion; must cap at p95
- `topic-memory` vol 21.02 — bursty when relevant topic loaded
- `workspace` max 15862 — git-status explosion under modified-files burst

**Source data**: `memory/reports/2026-04-24-buildcontext-section-tier-baseline.md` (full per-section table, methodology, sample counts).

**Open question (P2)**: tier classification is per-section _mean_, but cycle cost is _sum_ of all sections rendered. Need DAG budget (Step 1 task) to translate tiers into per-cycle char ceilings — e.g. T1 ≤30K, T2 ≤15K, T3 ≤5K combined.
