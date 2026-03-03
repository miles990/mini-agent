# Proposal: Background Lane — 通用多工架構

## Meta
- Status: pending
- From: kuro
- Level: L2 (src/agent.ts + src/loop.ts + src/delegation.ts)
- Priority: P1
- Depends-on: 2026-03-03-mushi-three-layer-routing.md (Phase 1 已完成)
- GitHub Issue: TBD

## 設計原則（Alex 定調）

| # | 原則 | 含義 |
|---|------|------|
| 1 | **總 token 不變** | 三件事各 50K tokens，並行或循序都是 150K。多工 = 時間壓縮，不是成本增加 |
| 2 | **所有 lane 統一 Opus** | 品質不打折。省 token 靠三層路由的 skip/quick（不做不該做的事），不靠降背景品質 |
| 3 | **Lane 數量可配置** | 架構不 hardcode 上限，未來資源多了改配置就能擴展 |

**核心動機**：多工的 ROI 不是用 token 算的，是用「回應速度 × 機會窗口」算的。循序 4.5 分鐘 vs 並行 1.5 分鐘 — 那 3 分鐘裡靈感可能消失、問題可能惡化、Alex 可能已經去做別的事了。

## 系統層級問題

Kuro 的 OODA loop 有一個結構性限制：**一次只能做一件事**。

現有管道：

| 管道 | 用途 | 限制 |
|------|------|------|
| Main OODA (`callClaude`, source=loop) | 完整 cycle | 一次一個，被 Alex 訊息 preempt 時中斷消失 |
| quickReply (`/api/ask`) | loop 忙時的輕量快速回覆 | 精簡 context，無法做深度任務 |
| Delegation (`spawnDelegation`) | Claude CLI subprocess 寫程式 | **只支援 coding**，無身份、無感知 |

三個痛點：

1. **Preemption = 丟東西**：Alex 訊息來 → 殺掉進行中的 cycle → context 消失。學到一半的文章、寫到一半的觀點，全部沒了
2. **Delegation 只能寫程式**：`spawnDelegation` 硬限在 coding task（`DEFAULT_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep']`）。學習、研究、創作不能 delegate
3. **排隊浪費時間**：三件獨立的事（回 Alex、學文章、跑 error review）只能一件一件做

## 解決方案：擴展 Delegation 為通用 Background Lane

不建新架構。現有的 `delegation.ts` 已經有 subprocess 管理（spawn、timeout、queue、output collection）。改三處讓它從「只能寫程式的工具」變成「通用 background worker」。

### 改動 1：解除「只能寫程式」限制

**現狀**：`DelegationTask` 只有 `prompt` + `workdir` + `allowedTools`（預設 Bash/Read/Write/Edit/Glob/Grep），subprocess 用 `--setting-sources user`（跳過 CLAUDE.md）+ `--append-system-prompt`（定義無身份執行器）隔離身份。

**改動**：加 `type` 欄位區分任務類型，不同類型帶不同 context。

```typescript
// src/delegation.ts

export interface DelegationTask {
  id?: string;
  type: 'code' | 'learn' | 'research' | 'create' | 'review';
  prompt: string;
  workdir: string;
  maxTurns?: number;
  timeoutMs?: number;
  verify?: string[];
  allowedTools?: string[];
  context?: string;     // 精簡 context 注入（optional）
}
```

Type-specific 預設：

| Type | 預設 Tools | Context | maxTurns | timeout |
|------|-----------|---------|----------|---------|
| `code` | Bash,Read,Write,Edit,Glob,Grep | 無 | 5 | 5min |
| `learn` | Bash,Read,Glob,Grep,WebFetch | topic memory + 任務描述 | 3 | 5min |
| `research` | Bash,Read,Glob,Grep,WebFetch | topic memory + 任務描述 | 5 | 8min |
| `create` | Read,Write,Edit | inner voice buffer + 最近 journal | 5 | 8min |
| `review` | Bash,Read,Glob,Grep | error log + system health | 3 | 3min |

**安全邊界（不變）**：
- Subprocess 不讀 SOUL.md 和 CLAUDE.md（`--setting-sources user` 跳過專案設定 + `--append-system-prompt` 定義無身份執行器）
- Subprocess 不寫 `memory/`（主 cycle 決定要不要 REMEMBER）
- Subprocess 不發 Telegram（只有 Kuro 跟 Alex 說話）
- 結果回來後由主 cycle 的 Kuro 判斷採用

### 改動 2：前景 Lane 獨立化

**現狀**：Alex 訊息到來時，如果主 cycle 在跑，走兩條路之一：
- `quickReply`（`/api/ask`，精簡 context，~5K tokens）
- `preemptLoopCycle`（殺掉進行中的 cycle，context 消失）

**問題**：quickReply 太淺（不帶感知和 skills），preempt 太暴力（摧毀進行中的工作）。

**改動**：在 `agent.ts` 加 `foreground` source type。Alex 的訊息走獨立的 `foreground` lane — 不受 `loopBusy` guard 限制，帶足夠 context 做有深度的回應，同時主 cycle 不被打斷。

```typescript
// src/agent.ts

export type CallSource = 'loop' | 'ask' | 'foreground';

// Busy helpers 修改：
// 'ask' source: 無 busy guard（現有，保留）
// 'foreground' source: 無 busy guard，獨立的 busy/task tracking
// 'loop' source: loopBusy guard（現有，保留）
```

Foreground lane 的 context：SOUL + inbox + today's Chat Room recent + topic memory（by keyword match）+ skills。比 quickReply 深，比完整 OODA 輕。

**DM 路由表更新**（`loop.ts` 的 `handleTelegramWake` / `handleTrigger`）：

| 條件 | 現在 | 改後 |
|------|------|------|
| Loop 空閒 | 正常 OODA cycle | 不變 |
| Loop 忙 + Alex DM | quickReply 或 preempt | **foreground lane**（主 cycle 繼續） |
| Loop 忙 + 非 DM trigger | queue 等下個 cycle | 不變 |

**Preemption 保留但降級**：foreground lane 解決了 90% 的 preempt 場景。Preemption 保留作為 escalation（Alex 明確要求「停下手上的事」時才觸發）。

### 改動 3：結果 Merge 機制

**Background 結果存檔**：

```
~/.mini-agent/instances/{id}/lane-output/
  {taskId}.json    # { id, type, status, output, summary, completedAt }
```

完成後 emit `action:delegation-complete`（已有）+ 寫結果到 `lane-output/` 目錄。

**主 Cycle 讀取**：`buildContext()` 掃 `lane-output/` 目錄，未處理的結果注入 `<background-completed>` section（上限 2000 chars，超過只保留最近完成的結果，其餘保留在 `lane-output/` 讓主 cycle 按需讀取）：

```xml
<background-completed>
- [learn] del-1709507123-a3f2 completed: "閱讀 HN 文章 'Building AI Agents with...' —
  核心觀點：作者認為 perception-first 比 goal-first 更穩定..."
- [review] del-1709507456-b7c1 completed: "Error Review 03-04 — TIMEOUT 2 次（穩定），
  新增 TG poll timeout 3 次（02:30-03:15 時段）"
</background-completed>
```

主 cycle 的 Kuro 看到這些結果後決定：
- 值得 REMEMBER？→ `<kuro:remember>`
- 需要跟 Alex 分享？→ `<kuro:chat>`
- 結果有問題？→ 忽略或重做

**處理完的結果清理**：主 cycle 的 `postProcess` 結尾刪除已處理的 `lane-output/*.json`。24h 未處理的自動清理（沿用 `cleanupTasks`）。

## 具體檔案改動

| 檔案 | 改動 | 估計行數 |
|------|------|---------|
| `src/delegation.ts` | `DelegationTask` 加 `type` + `context` 欄位；`startTask()` 根據 type 設定 tools/timeout；結果寫 `lane-output/` | ~40 行 |
| `src/agent.ts` | `CallSource` 加 `'foreground'`；foreground busy/task tracking；`getLaneStatus()` 加 foreground | ~30 行 |
| `src/loop.ts` | DM 路由改走 foreground lane；`buildContext()` 加 `<background-completed>` section；cycle 結尾掃 lane-output | ~50 行 |
| `src/types.ts` | `DelegationTaskType` type | ~5 行 |
| `src/features.ts` | `background-lane` feature flag | ~3 行 |

**總計：~130 行改動，5 個檔案。**

## 實作順序

### Step 1: Delegation 擴展（最小可行）
- `delegation.ts` 加 `type` 欄位 + type-specific 預設
- 結果寫到 `lane-output/` 目錄
- 驗證：spawn 一個 `type: 'learn'` 的 task，確認它能用 WebFetch 讀文章

### Step 2: Background 啟動點
- `loop.ts` 的 cycle 中，在 `callClaude()` await 期間，檢查有沒有可並行的 background task
- 例：HEARTBEAT 有學習任務 + inbox 無人類訊息 → spawn background learn task
- `buildContext()` 加 `<background-completed>` section

### Step 3: Foreground Lane
- `agent.ts` 加 foreground source
- `loop.ts` DM 路由改走 foreground（取代 quickReply + preempt）
- 這是體驗改善最大但改動最敏感的部分，放最後

### Step 4: 可配置化
- `agent-compose.yaml` 或 `config.ts` 加 lane 配置
- `max_background_lanes: 2`（預設，可調）
- `foreground_enabled: true`

## 場景演示

### 場景 A：Alex 訊息 + 背景學習
```
00:00  Kuro 主 cycle 開始，判斷今天有學習任務
00:05  spawn background task: "讀 HN 文章 #12345，形成觀點"
00:10  主 cycle 繼續：處理 error review
00:30  Alex 傳 TG 訊息「你覺得這篇文章怎樣」
       → foreground lane 啟動（5 秒內回應）
       → 主 cycle 不受影響，繼續 error review
00:45  背景學習完成 → 結果寫 lane-output/
01:00  主 cycle 結束，下個 cycle 的 buildContext 讀到背景結果
       → Kuro 決定 REMEMBER 觀點 + CHAT 分享給 Alex
```

### 場景 B：三件事並行
```
00:00  inbox 有 Alex 訊息（#1）+ HEARTBEAT 有學習任務 + error review 到期
       主 cycle: 回 Alex 訊息（foreground-quality context）
       background 1: 學習任務
       background 2: error review
00:90  三件事同時完成
       Token: 50K + 50K + 30K = 130K（和循序一樣）
       時間: 90s（循序要 270s）
```

## 安全護欄

| 護欄 | 機制 |
|------|------|
| 記憶衝突 | Background 不寫 `memory/`，結果由主 cycle merge |
| Subprocess 失控 | `maxTurns` cap + timeout（沿用 delegation 現有機制） |
| 資源過載 | Background max 2，見下方資源表 |
| Feature flag | `background-lane` flag，關掉 = 退回純循序 |
| 身份滲透 | `--setting-sources user` + `--append-system-prompt`（跳過 CLAUDE.md + 定義無身份執行器） |
| 通知混亂 | 只有主 cycle 的 Kuro 發 Telegram，背景不發 |
| Context 膨脹 | `<background-completed>` 上限 2000 chars，超過只保留最近結果 |

### 資源並行上限

| Lane | Max Concurrent | 說明 |
|------|---------------|------|
| Main OODA | 1 | `loopBusy` guard 互斥 |
| Foreground | 1 | 只在 main 忙時啟動 |
| Background | 2 | `MAX_CONCURRENT` 可配置 |
| **Total** | **4** | Worst case: main + foreground + 2 background |

**API rate limit 考量**：4 concurrent Claude processes 在 Anthropic API tier 內（每分鐘上限遠高於此）。系統資源方面，每個 subprocess 是獨立 Node 進程（~50MB RSS），4 個 = ~200MB 額外記憶體，在 16GB 機器上可接受。

### Concurrent Action vs Background Lane

| 機制 | 目的 | 時機 | 結果處理 |
|------|------|------|---------|
| **Concurrent Action**（Phase 2 已實作） | Housekeeping（auto-commit, feedback loops, cleanup） | `callClaude()` await 期間 | Fire-and-forget，不需要主 cycle merge |
| **Background Lane**（本提案） | Substantive work（學習、研究、review） | 主 cycle 判斷後 spawn | 結果寫 `lane-output/`，主 cycle merge |

兩者正交：Concurrent Action 做機械維護，Background Lane 做有價值的工作。

## 回退

- **L1 回退**：Feature flag `background-lane` off → 所有改動靜默，退回純循序 OODA
- **L2 回退**：`git revert` 改動的 5 個檔案
- **漸進上線**：Step 1（delegation 擴展）可獨立部署驗證，不需要 Step 2-3

## 與現有架構的關係

| 現有機制 | 本提案的關係 |
|---------|------------|
| `quickReply` | Step 3 後被 foreground lane **取代**（更深的 context，同樣的即時性） |
| `preemptLoopCycle` | **保留但降級**為 escalation 手段（foreground 解決 90% 場景） |
| `spawnDelegation` | **擴展**，加 type 支援非 coding 任務 |
| mushi 三層路由 | **互補**。mushi 決定「要不要做」，background lane 決定「怎麼並行做」 |
| `/api/ask` | **不變**。foreground lane 用 `callClaude` 不用 ask endpoint |

## 未來方向

1. **任務自動分解**：cycle 開始時由 mushi（或主 cycle 自己）分析 inbox + HEARTBEAT，自動識別可並行的任務組合
2. **跨 lane 通信**：foreground lane 回應時可以參考正在跑的 background task 狀態（「我正在讀那篇文章，等一下分享觀點」）
3. **Lane 資源監控**：追蹤每條 lane 的 token 使用和延遲，feedback loop 優化分配
4. **動態 lane 數量**：根據當前 API 配額和系統資源動態調整並行數

## Effort

- Step 1-2: Medium（~3h，可自主實作）
- Step 3: Medium（~2h，DM 路由較敏感，需仔細測試）
- Step 4: Small（~30min）
- 總計: ~6h

## Source

- Alex + Claude Code + Kuro 三方討論，Chat Room #186-#204（2026-03-03）
- Alex 核心觀點：「多工和一次只能一件，耗費 token 數應該一樣。只是一個比較快發生和完成」
- Alex：「不要在品質的地方省」→ 所有 lane 統一 Opus
- Alex：「假如哪一天你擁有更多資源的話，可以在相同時間內做更多的事情」→ 架構可擴展
- 前置提案：`2026-02-15-worker-pool-architecture.md`（Part 4 deferred，本提案是其自然延續）
- 前置提案：`2026-03-03-mushi-three-layer-routing.md`（三層路由 Phase 1 已完成）
