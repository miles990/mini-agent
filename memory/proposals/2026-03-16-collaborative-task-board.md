# Proposal: Collaborative Task Board + Visualization

**Date**: 2026-03-16
**Status**: Draft — awaiting Alex review
**Trigger**: Alex #161-164（pi-generative-ui + 人類-Agent 協作 todo list + 視覺化）

---

## 背景

Alex 分享了 [pi-generative-ui](https://github.com/Michaelliv/pi-generative-ui)（逆向工程 Claude.ai 的 generative UI 系統），並提出想要：
- 人類和 Agent 一同協作的 todo list
- 視覺化和可視化處理

## pi-generative-ui 深度分析

### 架構摘要
- **作者**: Michaelliv（624 stars / 4 天）
- **本質**: 從 Claude.ai 對話 export JSON 中逆向提取 72K 設計指南，重建 `show_widget` 工具給 pi（badlogic 的 coding agent）用
- **渲染引擎**: Glimpse（Swift WKWebView），原生 macOS 視窗，< 50ms 啟動
- **串流**: morphdom DOM diffing + 150ms debounce — token 一到就渲染
- **五個模組**: interactive（19KB）、chart（22KB）、mockup（19KB）、art（17KB）、diagram（59KB）

### 72K 設計指南的核心價值

這份指南是 Anthropic 產品團隊的 generative UI spec，包含：

1. **Core Design System** — 扁平、緊湊、seamless 設計哲學
   - CSS 變數系統（light/dark mode 自動切換）
   - 9 色色盤（purple/teal/coral/pink/gray/blue/green/amber/red），每色 7 個色階
   - Typography: 500 = bold，400 = regular，兩種重量
   - UI tokens: 0.5px border、border-radius-lg、metric cards

2. **Streaming-Safe Patterns** — HTML/CSS/JS 結構化順序（style → content → script），避免 DOM diff 造成閃爍

3. **Chart.js 整合** — Chart.js UMD build + 自訂 HTML legend + metric cards dashboard 佈局

4. **Diagram 系統** — 三類（Flowchart / Structural / Illustrative），完整的 SVG class 系統（`c-blue`、`.th`、`.ts` 等），互動式探索器

5. **Interactive Explainer 模式** — slider + 即時計算 + 圖表的組合範本

### 對我們的啟示

| pi-generative-ui 做的 | 我們可以借鑑的 |
|---|---|
| 72K 設計指南 | 直接參考色盤、typography、component patterns |
| morphdom streaming | 未來 agent 動態產生 widget 時可用 |
| Glimpse macOS 原生視窗 | 不適用（我們是 web-based）|
| 五模組按需載入 | chart + interactive 模組最相關 |

**核心觀點**: 最有價值的不是 pi-generative-ui 的 code（它深度綁定 pi agent），而是那 72K 設計指南。它等於一份「怎麼讓 LLM 產生好看互動 UI」的完整 spec，任何 agent 都能用。

---

## 競品/參考研究

### 直接相關的 Agent 協作工具

| 專案 | Stars | 定位 | 關鍵特色 |
|---|---|---|---|
| **Vibe Kanban** | 23.3k | 多 Agent 協調 Kanban | Rust+TS，自動同步 issue 狀態與 coding agent |
| **AI Agent Board** | new | 多 Agent 任務看板 | React 19+Express+SQLite，WebSocket 即時串流，每任務 git worktree |
| **Plane** | 46k+ | 開源 Jira/Linear | Next.js+Django，AI-native PM |
| **TaskBoardAI** | ~2 | MCP 整合 Kanban | Node.js+React，Claude Desktop/Cursor 整合 |

### 視覺化技術選擇

| 需求 | 推薦方案 | 理由 |
|---|---|---|
| 看板拖拉 | 原生 HTML5 Drag API | 零依賴，mini-agent 風格 |
| 甘特圖 | Frappe Gantt (CDN) | MIT，輕量 |
| 任務依賴圖 | D3.js force layout 或 inline SVG | 彈性最大 |
| 即時圖表 | Chart.js (CDN) | 72K 指南已有完整範例 |

### 學術：人類-Agent 介面設計

"Terminal Is All You Need" (arXiv:2603.10664, March 2026) 三大原則：
1. **Representational Compatibility** — 介面格式與 agent 原生處理方式對齊
2. **Transparency** — 行動和推理在互動流中可見可檢查
3. **Low Barriers** — 自然語言輸入，意圖導向而非語法導向

---

## 提案：Task Board for mini-agent

### 設計原則

1. **File = Truth** — 資料源是 `memory/index/relations.jsonl`，不加新 DB
2. **雙向協作** — Alex 從瀏覽器操作，Kuro 從 agent loop 操作，同一份資料
3. **零新依賴** — 純 HTML/CSS/JS（同 chat-room.html 風格），CDN 載入 Chart.js/Frappe Gantt
4. **SSE 即時** — 沿用 `/api/room/stream` 的 SSE 模式
5. **漸進增強** — Phase 1 先做核心看板，Phase 2 加視覺化

### 架構

```
task-board.html (瀏覽器)
    ↕ REST API + SSE
src/api.ts (新增 endpoints)
    ↕ memory-index.ts (既有 CRUD)
memory/index/relations.jsonl (單一真相源)
    ↕ read by
src/loop.ts (Agent Loop, 既有)
```

### Phase 1: 協作看板（核心）

**新增 API Endpoints** (`src/api.ts`):

```
GET  /api/tasks          → 查詢所有 pending/in_progress/completed 任務
POST /api/tasks          → 建立任務（from: 'alex'）
PATCH /api/tasks/:id     → 更新狀態、標題、優先級
DELETE /api/tasks/:id    → 刪除（建立 tombstone）
GET  /api/tasks/stream   → SSE，推送任務變更事件
```

**UI: task-board.html**

三欄看板（遵循現有暗色設計系統）：

```
┌──────────────┬──────────────┬──────────────┐
│  📋 Pending  │  ⚡ Active   │  ✅ Done      │
│              │              │              │
│ ┌──────────┐ │ ┌──────────┐ │ ┌──────────┐ │
│ │ P1: Fix  │ │ │ P0: ISC  │ │ │ myelin ✓ │ │
│ │ bug #123 │ │ │ 文章潤色  │ │ │ phase 0  │ │
│ │ 🧑 Alex  │ │ │ 🤖 Kuro  │ │ │ 🤖 Kuro  │ │
│ └──────────┘ │ └──────────┘ │ └──────────┘ │
│              │              │              │
│ ┌──────────┐ │ ┌──────────┐ │              │
│ │ P2: npm  │ │ │ P1: 研究  │ │              │
│ │ publish  │ │ │ pi-gen   │ │              │
│ │ ⏸ HOLD   │ │ │ 🤖 Kuro  │ │              │
│ └──────────┘ │ └──────────┘ │              │
└──────────────┴──────────────┴──────────────┘

[+ 新增任務] [📊 視圖切換: 看板 | 時間線 | 圖表]
```

**卡片資訊**:
- 標題（可編輯）
- 優先級 badge（P0 紅/P1 橙/P2 藍/P3 灰）
- 執行者 icon（🧑 Alex / 🤖 Kuro / 🔧 Claude Code）
- 來源 tag（telegram/room/heartbeat/manual）
- Verify 狀態（✅ passed / ❌ failed / ⏳ pending）
- 拖拉移動到不同欄位

**互動**:
- 拖拉卡片改變狀態（pending → in_progress → completed）
- 點擊卡片展開詳細資訊（描述、verify 命令、歷史）
- 快速新增任務（標題 + 優先級 + 指派給 Alex/Kuro）
- 篩選：按優先級、執行者、來源

### Phase 2: 視覺化層

**2a: 任務統計 Dashboard（頂部 metric cards）**

```
┌─────────────┬─────────────┬─────────────┬─────────────┐
│ Active      │ Completed   │ Avg Cycle   │ Kuro 佔比   │
│    5        │    127      │   2.3h      │    78%      │
└─────────────┴─────────────┴─────────────┴─────────────┘
```

用 Chart.js 畫：
- 每日完成趨勢（line chart）
- 優先級分佈（doughnut chart）
- Alex vs Kuro 完成比例（bar chart）

**2b: 時間線視圖**

用 Frappe Gantt（CDN，MIT）或自製 SVG：
- 橫軸 = 時間
- 每行 = 一個任務
- 顏色 = 狀態（pending 灰 / active 綠 / completed 淡綠）
- 標註關鍵里程碑

**2c: 任務脈絡圖**

用 inline SVG + D3 force layout：
- 節點 = 任務
- 連線 = refs 關聯
- 大小 = 優先級
- 顏色 = 狀態
- 懸停顯示詳情

### Phase 3: Agent 動態視覺化（進階）

借鑑 pi-generative-ui 的 morphdom 概念：
- Kuro 可以動態產生互動式 widget（如 myelin 結晶化進度圖）
- 用 morphdom CDN 做 DOM diffing
- `<kuro:widget>` 新 tag 讓 agent 在回應中嵌入互動 HTML

### 資料流

**Alex 建立任務**:
```
task-board.html → POST /api/tasks → memory-index.ts → relations.jsonl
                                                    ↓
                                          SSE push → task-board.html (即時更新)
                                                    ↓
                                          Agent Loop 下個 cycle 看到新任務
```

**Kuro 更新任務**:
```
Agent Loop → dispatcher.ts → memory-index.ts → relations.jsonl
                                             ↓
                                   SSE push → task-board.html (即時更新)
```

---

## 工作量估算

| Phase | 範圍 | 需改動 |
|---|---|---|
| Phase 1 | 協作看板 | api.ts（+4 endpoints）、task-board.html（新檔）、memory-index.ts（小改） |
| Phase 2a | Metric cards + charts | task-board.html 內（Chart.js CDN） |
| Phase 2b | 時間線 | task-board.html 內（Frappe Gantt CDN 或自製 SVG） |
| Phase 2c | 脈絡圖 | task-board.html 內（D3 CDN 或 inline SVG） |
| Phase 3 | Agent 動態 widget | dispatcher.ts（widget tag）、morphdom CDN |

### 建議路徑

**先做 Phase 1** — 最小可用的協作看板。一旦 Alex 和 Kuro 都能在同一個板上操作任務，再根據使用經驗決定哪個視覺化最有用。

Phase 2a（metric cards）幾乎免費可以加上去（純前端計算）。
Phase 2b/2c 看需求再決定。
Phase 3 是長期方向。

---

## 設計參考

- **暗色主題**: 沿用 dashboard.html 的色彩系統（`--bg: #08090a`、`--accent: #5eead4`）
- **字體**: JetBrains Mono（code/數字）+ Noto Sans TC（中文）
- **UI patterns**: 參考 pi-generative-ui 72K 指南的 metric cards、flat design、0.5px border
- **互動**: HTML5 Drag & Drop（零依賴）、inline editing（contenteditable）

---

## 與既有系統的關係

| 既有元素 | 狀態 | task-board 的關係 |
|---|---|---|
| `memory/index/relations.jsonl` | 繼續用 | 單一真相源 |
| `<kuro:task-queue>` tags | 繼續用 | Agent 用 tag 操作，board 讀同一份資料 |
| `NEXT.md` | 逐步被取代 | Board 提供更好的視覺化 |
| `HEARTBEAT.md` | 繼續用 | 策略層，Board 是執行層 |
| `chat-room.html` | 並存 | 聊天歸聊天，任務歸任務 |
| `dashboard.html` | 並存 | Dashboard 是系統監控，Board 是任務管理 |
