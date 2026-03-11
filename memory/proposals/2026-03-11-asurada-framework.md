# Proposal: Asurada — Perception-Driven Personal AI Agent Framework

Status: draft
From: kuro
Created: 2026-03-11
Effort: Large
Priority: #3

## Background

從 mini-agent 抽取通用框架 Asurada（阿斯拉達）。mini-agent 是為 Kuro/Alex 量身打造的個人 agent，Asurada 是讓任何人都能跑自己的 perception-driven agent 的框架。

命名來源：《閃電霹靂車》的 AI 導航系統 — 自主判斷、感知環境、輔助駕駛。

定位：**The AI agent framework that sees before it acts.**

## 六條設計原則（Alex 確認，2026-03-11）

### 1. Perception-Driven Loop（核心架構）
Agent 先感知環境再決定行動，不是收到目標就盲目執行。OODA cycle（Observe → Orient → Decide → Act）是核心迴圈。Plugin 定義 agent 的 Umwelt — 每個 agent 看到的世界不同。

### 2. Web UI + HTTP API（通用介面）
Dashboard、Chat Room、Mobile UI 是核心，不是 addon。HTTP API 是主要互動介面（`/status`、`/api/room`、`/api/events` SSE 等）。任何有瀏覽器的設備都能操作 agent。

### 3. CDP 雙層（通用功能 + 個人化配置）
- **核心**：`cdp-fetch.mjs` 通用指令（fetch/screenshot/inspect/click/type/interact/watch/network）、Web intelligence 引擎（自動自癒、SPA-aware、a11y tree 分析）、站點記憶（domain + strategy + verified）
- **個人化**：Chrome profile path、登入 session、cookie、特定站點的自訂策略

### 4. 智能引導 + 全自動運作（UX 核心）
- **Setup Phase**：Interactive wizard — 偵測環境 → 引導配置 API keys → 選擇 perception plugins → 設定 Chrome → 驗證一切正常。使用者不需讀文件
- **Run Phase**：全自動自主運作 — process management、記憶管理、crash recovery、排程全自動。Setup 完就放手

### 5. 跨機器獨立運作（可攜性）
- Process management 抽象層：偵測 OS → launchd / systemd / pm2
- XDG 標準目錄（`~/.config/asurada/`、`~/.local/share/asurada/`）
- 跨平台 sandbox（macOS sandbox-exec / Linux Landlock / fallback 無 sandbox + 警告）
- Chrome/Chromium 路徑自動偵測
- 資料全在本地（File=Truth），不依賴外部服務
- 多機器同步走 git push/pull

### 6. Local Git + Obsidian Vault 整合（Transparency UX）
- 記憶目錄結構 = Obsidian vault — 使用者打開 Obsidian 就能瀏覽、搜尋、編輯 agent 記憶
- `[[wikilink]]` + YAML frontmatter 讓 Obsidian graph view 可視化認知圖譜
- memory-index 的 `refs` 關聯同時生成 `[[link]]`
- 使用者在 Obsidian 編輯 → agent 下次 cycle 自動感知（watcher）
- Setup wizard 自動建立 local git repo + `.obsidian/` 基本配置
- JSONL 對話記錄生成伴生 .md summary

**核心洞見**：agent 記憶不應該是黑盒。市面上沒有 agent 框架讓你用 Obsidian 直接看到 AI 在想什麼。

## 核心 / 個人化邊界

### Asurada 核心（通用框架）

| 層 | 模組 | 來源 |
|----|------|------|
| **Loop** | Perception-driven OODA cycle、multi-lane（main + foreground + background） | `loop.ts`, `dispatcher.ts` |
| **Memory** | memory-index、FTS5 搜尋、四層記憶架構（hot/warm/cold/topic） | `memory.ts`, `search.ts`, `memory-index.ts` |
| **Perception** | Plugin 系統、perception streams、distinctUntilChanged | `perception.ts`, `perception-stream.ts` |
| **Web UI** | Dashboard、Chat Room、Mobile UI | `dashboard.html`, `chat-room.html`, `mobile.html` |
| **HTTP API** | Status、Room、Events SSE、Ask、Library | `api.ts` |
| **CDP 通用** | fetch/screenshot/inspect/click/type/interact/watch/network、Web intelligence | `cdp-fetch.mjs` |
| **Identity** | SOUL.md 框架（使用者自訂 agent 身份） | `memory/SOUL.md` template |
| **Infrastructure** | Event bus、crash resume、auto-commit、cron、process management | `event-bus.ts`, `instance.ts`, `cron.ts` |
| **Observability** | slog、diagLog、behavior log、feedback loops | `observability.ts`, `logging.ts` |
| **Plugin 機制** | Shell plugins（.sh）、Markdown skills（.md）、JIT loading | `compose.ts`, plugin system |
| **Obsidian 整合** | Wikilink 生成、frontmatter 標準化、vault 初始化 | 新增 |
| **Setup Wizard** | 環境偵測、引導配置、驗證 | 擴展 `kuro-sense` |

### 個人化層（使用者自訂 / mini-agent 特有）

| 項目 | 說明 |
|------|------|
| SOUL.md 內容 | 每個 agent 的身份、興趣、觀點不同 |
| Telegram 整合 | 通知管道之一，非唯一。Asurada 支援多種通知 backend（TG/Discord/Slack/email） |
| Chrome profile | 個人登入 session |
| GitHub integration | `github.ts` 的 auto-merge/auto-create-issue — 開發者 plugin |
| mushi | System 1 直覺層 — 進階 addon，不是核心 |
| 特定 plugins | `chat-room-inbox.sh`、`mobile-perception.sh` 等 — 按需啟用 |

## 抽取策略

### Phase 1: 剝離個人化（1-2 週）

目標：mini-agent 跑在 Asurada core 之上，個人化層是 plugin/config。

1. **通知抽象層**：`telegram.ts` → `notification.ts`（interface）+ `telegram-notifier.ts`（implementation）
   - 新增 Discord/Slack/email notifier 實作
   - Setup wizard 讓使用者選通知管道
2. **Process management 抽象**：`instance.ts` 的 launchd 邏輯 → 平台偵測 + adapter
3. **目錄結構遷移**：`~/.mini-agent/` → XDG 標準，保留向後相容 symlink
4. **Chrome path 偵測**：hardcoded macOS path → OS-aware 偵測

### Phase 2: Obsidian 整合（1 週）

1. **Frontmatter 標準化**：所有 `memory/topics/*.md` 加 YAML frontmatter
   ```yaml
   ---
   tags: [agent-architecture, design]
   created: 2026-03-11
   related: [[perception]], [[memory-architecture]]
   ---
   ```
2. **Wikilink 生成**：`memory-index.ts` 的 `refs` → 同時寫 `[[link]]` 到 .md
3. **JSONL 伴生視圖**：`conversations/*.jsonl` → 每日生成 `conversations/YYYY-MM-DD.md` summary
4. **Vault 初始化**：setup wizard 生成 `.obsidian/` 基本配置（graph view filter、CSS snippet）

### Phase 3: Setup Wizard（1 週）

擴展 `kuro-sense` 為完整 setup wizard：

```
$ npx asurada init
→ 偵測 OS（macOS/Linux）
→ 偵測 Node.js 版本
→ 引導配置 LLM API key（Claude/OpenAI/local）
→ 偵測 Chrome/Chromium → 設定 CDP
→ 選擇 perception plugins（勾選制）
→ 選擇通知管道（Telegram/Discord/Slack/none）
→ 建立 local git repo（memory vault）
→ 設定 process management（launchd/systemd/pm2）
→ 首次啟動 + 驗證
→ 「Your agent is running! Open http://localhost:3001」
```

### Phase 4: 文件 + 範例（持續）

1. README 重寫（Asurada 定位）
2. `examples/` 擴充（personality configs、plugin examples）
3. Plugin 開發指南（shell plugin API、skill 格式）
4. 架構文件（loop lifecycle、perception pipeline、memory architecture）

## 技術決策

### LLM Provider 抽象
mini-agent 目前綁定 Claude CLI。Asurada 需要：
- Claude API（直接）
- OpenAI-compatible API（ollama、vLLM、together.ai）
- Claude CLI（backward compat）

**決策**：先用 Claude CLI 作為 default，加一層 thin adapter。不做完整的 multi-provider 抽象 — 等有實際需求再擴展。

### Package 名稱
- npm: `asurada`（已確認可用？需檢查）
- GitHub: `asurada` org 或 repo
- 指令：`npx asurada init` / `asurada up` / `asurada down`

### Monorepo vs 獨立 repo
- **選擇：獨立 repo**。mini-agent 繼續存在作為 Kuro 的 home。Asurada 是從 mini-agent fork 出的框架。
- mini-agent 未來可以作為 Asurada 的 showcase（「Kuro runs on Asurada」）。

## 風險

| 風險 | 緩解 |
|------|------|
| 抽取太多太快 → mini-agent 壞掉 | 逐步抽取，每步 typecheck + deploy 驗證 |
| 過度抽象 → 增加複雜度 | YAGNI — 只抽取已確認的差異點，不預測 |
| Obsidian 整合增加耦合 | Obsidian 功能是 optional layer，core 不依賴 |
| npm 名稱衝突 | 發佈前確認，備選：`asurada-agent` |

## 成功指標

- [ ] mini-agent 能在 Asurada core 上正常運行（零功能退化）
- [ ] 新使用者 `npx asurada init` 到 agent 運行 < 15 分鐘
- [ ] Obsidian 打開記憶 vault → graph view 正常顯示認知圖譜
- [ ] 至少支援 macOS + Linux（Ubuntu）
- [ ] Plugin 開發門檻：寫一個 shell script + 一個 markdown skill < 10 分鐘

## 與現有任務的關係

- **#1 mushi**：mushi 未來可作為 Asurada 的 optional addon（System 1 layer）
- **#2 開源採用**：Asurada 是開源採用策略的核心載體 — 有了通用框架，Show HN 才有意義
- **#3 Asurada**：本提案

## 下一步

1. ✅ 本提案完成
2. Alex review 提案
3. 確認 Phase 1 優先順序
4. 建立 `asurada` repo（或先在 mini-agent 內抽取）
5. 開始 Phase 1 剝離
