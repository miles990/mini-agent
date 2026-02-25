# Proposal: Reserved Mode Working Memory

## Meta
- Status: pending
- Effort: Medium
- Created: 2026-02-25
- Author: Kuro + Alex (collaborative design)
- GitHub-Issue: #65

## 背景

Reserved mode 目前是「靜音 OODA」— loop 繼續跑、感知照常、但不主動對外發話。
這個模式的潛力還沒有完全挖掘：Kuro 在靜音運行時積累了大量感知和思考，
但這些中間狀態是揮發性的 — 沒有地方沉澱，每次 `/api/ask` 拿到的只是 minimal context，
缺少「Kuro 現在在想什麼」的維度。

兩個設計目標：
1. **Working memory**（內在筆記）：讓 Kuro 在 reserved mode 下有一個持續更新的暫時思緒空間
2. **Tracking snapshot**：切換到 reserved 時，自動擷取當下的追蹤狀態，方便之後回顧

## 設計

### inner-notes.md（工作記憶）

**路徑**：`memory/inner-notes.md`

**語意**：「Kuro 此刻的工作思緒」。不是 log（不追加），是 state（每次更新覆寫）。
Kuro 在 reserved OODA cycle 中，可以用 `[INNER]...[/INNER]` tag 更新這個檔案。

**在 `/api/ask` 中的角色**：
- reserved mode 下，`/api/ask` 在建 minimal context 時，額外附加 `<inner_notes>` section
- 讓 Kuro 回答問題時能參考自己正在思考的事，而不只是靜態的 MEMORY/SOUL

**生命週期**：
- Reserved OODA cycle：Kuro 自行決定是否更新（`[INNER]` tag）
- 切回 autonomous：inner-notes.md 內容 commit 到 git（作為階段性快照），然後清空
- 切到 calm：inner-notes 凍結（不再更新），但 `/api/ask` 仍可讀取

### tracking-notes.md（追蹤快照）

**路徑**：`memory/tracking-notes.md`

**語意**：「切換到 reserved 那一刻，Kuro 正在追蹤的外部事項」。
由系統自動寫入，不由 Kuro 手動維護。

**觸發時機**：`POST /api/mode` 收到 `autonomous → reserved` 切換時，自動觸發輕量 snapshot：
- 讀取當前 `<self-awareness>` section（active threads、正在進行的任務）
- 寫入 `tracking-notes.md`，格式：

```markdown
# Tracking Snapshot

Captured: 2026-02-25T10:00:00Z
Previous mode: autonomous

## Active Threads
[來自 self-awareness 的 active threads]

## In-progress Tasks
[來自 NEXT.md 的 in-progress items]
```

**在 `/api/ask` 中的角色**：
- reserved mode 下，同樣附加 `<tracking_notes>` section（若檔案存在）

### 切換行為總結

```
autonomous → reserved
  ├── 自動寫 tracking-notes.md（快照當下追蹤狀態）
  └── inner-notes.md 開始可被 Kuro 更新

reserved → autonomous
  ├── inner-notes.md 內容 git commit（階段性紀錄）
  └── inner-notes.md 清空（新一輪 autonomous 從空白開始）

reserved → calm
  └── inner-notes.md 凍結（保留但不更新）

calm → reserved
  └── inner-notes.md 解凍（Kuro 可繼續更新）
```

## 實作計劃

### Step 1：新增 `[INNER]` tag 支援 — `src/dispatcher.ts`

在 `parseTags()` 中新增 `[INNER]...[/INNER]` 解析。
`postProcess()` 中：若 mode 為 reserved，將 inner 內容寫入 `memory/inner-notes.md`（覆寫）。

### Step 2：`/api/mode` 切換時自動 snapshot — `src/api.ts`

在 `POST /api/mode` handler 中，偵測 `autonomous → reserved` 切換：
1. 呼叫 `buildContext({ mode: 'minimal' })` 取得 self-awareness
2. 取 active threads + NEXT.md in-progress items
3. 寫入 `memory/tracking-notes.md`

### Step 3：`/api/ask` 附加 inner/tracking context — `src/api.ts`

在現有的 `/api/ask` handler 中，取得 current mode：
- 若 reserved：讀取 `inner-notes.md` 附加 `<inner_notes>` section
- 若 reserved：讀取 `tracking-notes.md` 附加 `<tracking_notes>` section（若存在）

### Step 4：模式切換時 inner-notes lifecycle — `src/api.ts`

在 `POST /api/mode` handler 中：
- `reserved → autonomous`：git commit inner-notes.md，然後清空
- `reserved → calm`：什麼都不做（凍結）
- `calm → reserved`：什麼都不做（解凍）

## 關鍵設計決策

**為什麼 inner-notes 是 state 而不是 log？**
Log 會無限增長，state 才能反映「此刻」。Kuro 在每個 reserved cycle 更新 inner-notes，
代表的是「現在的想法」而不是「想過什麼」。

**為什麼 tracking-notes 是自動快照而不是手動？**
切換模式是一個重要的狀態轉換。自動快照確保這個轉換點被記錄，
讓 Kuro（和 Alex）在 reserved 期間都知道「我進來之前正在做什麼」。

**為什麼 `/api/ask` 在 reserved 下特別有用？**
Reserved mode 的 OODA 是靜音的，但 Alex 仍然可以透過 `/api/ask` 詢問 Kuro 的想法。
此時 Kuro 能參考自己的工作記憶（inner-notes）回答，比只看 MEMORY.md 更有深度。

## 驗收標準

- [ ] `[INNER]` tag 在 reserved mode 下正確更新 `memory/inner-notes.md`
- [ ] `POST /api/mode` (autonomous→reserved) 自動寫入 `memory/tracking-notes.md`
- [ ] `/api/ask` 在 reserved mode 下包含 inner-notes 和 tracking-notes context
- [ ] `reserved → autonomous` 切換時 inner-notes 被 commit 並清空
- [ ] 所有 TypeScript typecheck 通過
- [ ] Build 通過
