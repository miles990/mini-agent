# Proposal: Handoff Protocol v2 — 雙向進度管理 + 依賴追蹤

## Status: completed (2026-02-12)

## TL;DR

現有 Handoff Protocol 是 Kuro→Claude Code 的**單向委託**。只要加三個小擴展（雙向、依賴、子任務），就能變成完整的**雙向進度管理系統**——讓多 phase 專案（如 Reactive Architecture 4 個 phase）的協調從「靠記憶」變成「靠檔案」。

## Problem（現狀問題）

### 已有的 Handoff Protocol（v1）

v1 解決了核心問題：Kuro 可以透過 `memory/handoffs/` 委託 L2 任務給 Claude Code，Alex 只需審核，不用當 message broker。

但實際使用中發現三個限制：

### 1. 單向：只有 Kuro→Claude Code

```
Kuro ──handoff──> Claude Code    ✅ 有
Claude Code ──handoff──> Kuro    ❌ 沒有
```

實際場景：Claude Code 完成 Phase 2a (event-bus.ts) 後，需要 Kuro 做整合測試、跑數據分析、更新 SOUL.md 反思。目前只能在 Log 裡寫「完成了，Kuro 你去看」——但 Kuro 不一定會看到。

### 2. 無依賴關係

Reactive Architecture 有 4 個 phase，執行順序是：

```
Phase 2a → Phase 2c → Phase 2b → Phase 3a → Phase 3b → Phase 4
```

但 v1 的 handoff 之間沒有依賴欄位。如果同時建立 4 個 handoff，Claude Code 無法知道哪個該先做、哪個被什麼 block。

### 3. 無子任務追蹤

每個 Phase 內有多個步驟（例如 Phase 2a 有「建立 event-bus.ts」「加測試」「更新 CLAUDE.md」）。v1 的 Acceptance Criteria 只有最終驗收，沒有中間進度追蹤。

## Proposal（提案內容）

### 擴展 1: 雙向 — `To:` 欄位支持任意方向

v1 已有 `From:` 和 `To:` 欄位，格式上本來就支持雙向。只需要在約定中明確：

```markdown
## Meta
- From: claude-code        ← Claude Code 也可以是發起者
- To: kuro                 ← Kuro 也可以是接收者
- Reviewer: alex           ← 新增：誰審核（預設 Alex）
```

**方向組合**：

| From | To | 場景 | Reviewer |
|------|----|------|----------|
| kuro | claude-code | L2 功能實作（現有） | alex |
| claude-code | kuro | 整合測試、數據分析、反思 | alex |
| alex | claude-code | 直接指派開發任務 | — |
| alex | kuro | 直接指派學習/感知任務 | — |

**安全規則不變**：只有 `Status: approved` 的才能執行。Alex 的審核閘門不被繞過。

### 擴展 2: 依賴追蹤 — `Depends-on:` 欄位

```markdown
## Meta
- Status: pending
- From: kuro
- To: claude-code
- Depends-on: 2026-02-12-reactive-phase-2a.md   ← 新增
```

**規則**：
- 有 `Depends-on` 的 handoff，即使 `Status: approved`，也要等依賴完成（`Status: completed`）後才能開始
- 可以有多個依賴（逗號分隔）
- 循環依賴由人工審核時發現（不做自動偵測——KISS）

### 擴展 3: 子任務 — `## Tasks` section

```markdown
## Tasks
- [x] 建立 src/event-bus.ts 核心模組
- [x] 加 debounce/throttle/distinctUntilChanged 原語
- [ ] 寫單元測試
- [ ] 更新 CLAUDE.md event-bus 說明

## Acceptance Criteria
- [ ] pnpm typecheck 通過
- [ ] pnpm test 通過
```

**Tasks vs Acceptance Criteria**：
- `Tasks`：實作步驟，過程中逐步勾選，給執行者自己追蹤進度
- `Acceptance Criteria`：驗收條件，完成時全部通過，給審核者確認品質

### 具體範例：Reactive Architecture 用 Handoff v2 管理

```
memory/handoffs/
  2026-02-12-reactive-phase-2a.md     ← Event Bus 核心
  2026-02-12-reactive-phase-2c.md     ← 整合 TG/cron（Depends-on: 2a）
  2026-02-12-reactive-phase-2b.md     ← Loop 事件驅動（Depends-on: 2c）
  2026-02-12-reactive-phase-3a.md     ← 統一 observability（Depends-on: 2b）
  2026-02-12-reactive-phase-3b.md     ← Dashboard SSE（Depends-on: 3a）
  2026-02-12-reactive-phase-4.md      ← Perception stream（Depends-on: 3b）
```

Phase 2a 的 handoff 完整範例：

```markdown
# Handoff: Reactive Phase 2a — Event Bus Foundation

## Meta
- Status: pending
- From: kuro
- To: claude-code
- Reviewer: alex
- Created: 2026-02-12
- Proposal: proposals/2026-02-12-reactive-architecture.md
- Depends-on: (none)

## Task
建立 src/event-bus.ts，實現 AgentEventBus 核心基礎設施。
包含事件類型定義、reactive 原語（debounce/throttle/distinctUntilChanged）、
singleton eventBus 實例。

## Tasks
- [ ] 建立 src/event-bus.ts
- [ ] 定義 AgentEventType 和 AgentEvent 介面
- [ ] 實作 debounce(fn, ms)
- [ ] 實作 throttle(fn, ms)
- [ ] 實作 distinctUntilChanged(hashFn)
- [ ] 匯出 singleton eventBus
- [ ] 寫單元測試

## Acceptance Criteria
- [ ] pnpm typecheck 通過
- [ ] pnpm test 通過
- [ ] eventBus.emit / eventBus.on 基本流程可運作

## Context
參考 Reactive Architecture proposal 的 Phase 2a 段落。
~200 行 TypeScript，使用 node:events EventEmitter，零外部依賴。

## Log
- 2026-02-12 [kuro] 建立 handoff
```

Phase 2a 完成後，Claude Code 建立回傳 handoff：

```markdown
# Handoff: Reactive Phase 2a — 整合驗證

## Meta
- Status: pending
- From: claude-code
- To: kuro
- Reviewer: alex
- Created: 2026-02-12
- Depends-on: 2026-02-12-reactive-phase-2a.md

## Task
Phase 2a event-bus.ts 已實作完成。請 Kuro：
1. 在下次 loop cycle 中驗證 eventBus import 正常
2. 跑 3-5 個 cycle 觀察 behavior log 有無異常
3. 更新 SOUL.md 反思 reactive 架構的體感

## Acceptance Criteria
- [ ] Kuro loop 正常運作無錯誤
- [ ] Behavior log 格式正確

## Log
- 2026-02-12 [claude-code] 建立回傳 handoff，請 Kuro 驗證
```

## 相容性

### 只加欄位，不改格式

| 欄位 | v1 | v2 | 相容性 |
|------|----|----|--------|
| Status | ✅ | ✅ | 不變 |
| From | ✅ | ✅ | 不變 |
| To | ✅ | ✅ | 不變 |
| Created | ✅ | ✅ | 不變 |
| Proposal | ✅ | ✅ | 不變 |
| **Reviewer** | — | ✅ 新增 | 可選欄位，缺少時預設 Alex |
| **Depends-on** | — | ✅ 新增 | 可選欄位，缺少時表示無依賴 |
| **## Tasks** | — | ✅ 新增 | 可選 section，缺少時行為同 v1 |

**現有的 handoff 檔案不需要修改，v2 完全向後相容。**

### CLAUDE.md 更新

在 Handoff Protocol section 補充：
- 支持雙向（Claude Code 也可以是 From）
- 處理前檢查 `Depends-on` 是否已 completed
- Tasks checkbox 用於追蹤進度

### handoff-watcher.sh 更新

加顯示 `Depends-on` 和 Tasks 進度（`3/7 tasks done`）。

## Alternatives Considered

| 方案 | 優點 | 缺點 | 不選的原因 |
|------|------|------|-----------|
| **本提案**: 擴展 Handoff 欄位 | 向後相容、零成本、File=Truth | 手動管理依賴 | — |
| GitHub Projects / Issues | 有 Kanban、有依賴圖 | 離開 File=Truth、增加外部依賴 | 不符合 mini-agent 原則 |
| 獨立的 Task Manager 模組 | 自動依賴解析、並行排程 | 過度工程、需要新的 src/*.ts | 個人 agent 不需要 scheduler |
| NEXT.md 整合 | 複用現有任務系統 | NEXT.md 是 Kuro 的執行層，不適合跨 agent | 職責混淆 |

## Pros & Cons

### Pros
- **零成本擴展** — 只加可選欄位和 section，不改現有任何東西
- **完全向後相容** — 現有 v1 handoff 照常運作
- **File=Truth** — 依賴關係、進度全在檔案裡，git 可追蹤
- **解決實際痛點** — Reactive Architecture 4 phase 的協調有了明確載體
- **雙向閉環** — Claude Code 完成後可以正式回傳任務給 Kuro，不再靠 Log 裡的文字

### Cons
- **手動依賴管理** — 沒有自動依賴解析（但對 3-6 個 handoff 規模，手動就夠了）
- **子任務是 freeform** — checkbox 沒有結構化驗證（但人類可讀更重要）
- **不做自動建立** — 大專案需要手動建立多個 handoff 檔案（但每個檔案本身就是設計文檔，手動有價值）

## Effort: Small
## Risk: Low

只修改文件約定（CLAUDE.md）和一個 shell script (handoff-watcher.sh)。零 TypeScript 改動。最壞情況：新欄位不好用就不用，回到 v1 行為。

## Source

- Handoff Protocol v1 (`2026-02-11-file-based-handoff.md`) — 已驗證可行的基礎
- Reactive Architecture proposal — 多 phase 專案的實際需求
- 三方協作實踐中的觀察 — Claude Code 完成任務後缺乏正式回傳機制
