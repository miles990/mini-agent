# Proposal: 夯實地基 — 讓一般人覺得好用

Status: approved (Alex 直接指令)
Effort: L (多階段)
Priority: P0
Created: 2026-03-08

## 問題

mini-agent 對開發者來說是有趣的架構，但對一般人來說：
1. **不知道能幹嘛** — perception-driven、OODA cycle 是開發者語言
2. **裝完是空殼** — 預設 compose 沒有感知、沒有技能、loop 都沒開
3. **沒有引導** — 第一次啟動直接丟進 chat，不知道該說什麼
4. **配置太複雜** — agent-compose.yaml 有 20+ 選項，無引導

## 槓桿點分析（大處著眼）

一般人第一次接觸 mini-agent 的路徑：

```
安裝 → 第一次啟動 → ???（迷路）→ 離開
```

理想路徑：

```
安裝 → 第一次啟動 → 看到 agent 自動做了一件有用的事 → 驚喜 → 探索更多
```

**最大槓桿點：首次啟動到「第一個有用的事」之間的時間。**

如果這段時間 < 2 分鐘，用戶會留下。> 10 分鐘，用戶會離開。

## 複利分析

| 改動 | 影響範圍 | 複利效果 |
|------|---------|---------|
| 更好的預設 compose | 每個新用戶 | 開箱即用 → 降低放棄率 |
| 首次啟動引導 | 每個新用戶 | 知道能幹嘛 → 主動探索 |
| `mini-agent doctor` | 每次出問題 | 自助排除 → 減少求助 |
| 模板系統 | 不同場景用戶 | 適配度 → 留存率 |

**複利最高的是前兩項** — 影響每個用戶，且第一印象不可逆。

## 實作計劃（小處著手）

### Phase 1: 開箱即用（最高優先）

**1.1 預設 compose 升級**
- 開啟 workspace perception（偵測檔案變化）
- 開啟 docker perception（如果 docker 可用）
- 載入基礎 skills（debug-helper, project-manager）
- loop 預設開啟，interval 5m
- 預設 persona 更友善：不只是 "A helpful assistant"

**1.2 首次啟動歡迎訊息**
- 偵測到無 memory 目錄 → 是新安裝
- 顯示簡短歡迎 + 3 件馬上可以做的事
- 例：「我正在監控你的工作目錄。試試問我『最近改了什麼檔案？』」

**1.3 自動感知演示**
- 第一次 cycle 自動掃描工作目錄
- 主動報告發現：「你的專案有 X 個 TypeScript 檔案，最近改了 Y」
- 這是 perception-driven 的最佳展示 — show don't tell

### Phase 2: 降低門檻

**2.1 `mini-agent doctor`**
- 檢查 Node 版本、Claude CLI、磁碟空間
- 測試 Claude CLI 連線
- 驗證 compose 配置
- 輸出清楚的修復建議

**2.2 互動式設定**
- `mini-agent init` 升級為互動問答
- 問：你想叫 agent 什麼名字？想監控什麼？（Docker/Git/系統）
- 根據回答生成 compose

### Phase 3: 場景適配

**3.1 模板系統**
- `mini-agent init --template developer` — 程式碼監控 + Git + debug
- `mini-agent init --template devops` — Docker + 系統 + 告警
- `mini-agent init --template personal` — 學習 + 排程 + 筆記

## 先做什麼

Phase 1.1 + 1.2 — 改 compose.ts 的預設模板 + cli.ts 加歡迎訊息。
這是最小改動、最大影響的組合。
