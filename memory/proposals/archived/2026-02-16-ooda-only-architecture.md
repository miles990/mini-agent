# Proposal: OODA-Only — 統一為單一 OODA Cycle 架構

## Meta
- Status: implemented (2026-02-16, current architecture)
- GitHub-Issue: #14
- Author: claude-code (based on Alex + Kuro discussion)
- Level: L2 (涉及多個 src/*.ts)
- Effort: Medium (~4h)

## TL;DR

移除 Chat Lane 和 Haiku Lane，所有 Telegram 訊息統一由 Kuro 的 OODA Loop Cycle 處理。結果：一個 process、一個身份、一個對話者。

## 背景

目前的 Dispatcher 有三條路徑：

```
Alex 訊息 → triageMessage()
  ├─ regex-simple → Haiku Lane（無 SOUL/memory/perception context）
  ├─ regex-complex → Claude Chat Lane（獨立 Claude process）
  └─ cron/system → Claude Loop Lane（OODA cycle）
```

問題：
1. **Haiku Lane 回覆不像 Kuro** — 沒有完整 context（SOUL、memory、perception、threads），語氣和深度都不對
2. **Chat Lane 和 Loop Lane 是兩個獨立 Claude process** — 資源浪費、架構複雜
3. **Alex 希望 Kuro 是唯一對話者** — 目前 Haiku 回覆的東西身份模糊

## 設計

### 目標架構

```
Alex 訊息 → trigger:telegram-user → 喚醒 Loop → OODA cycle 處理 → 回覆
System 訊息 → trigger:* → Loop → OODA cycle 處理
```

只有一條路徑：**Loop Lane（OODA cycle）**。

### 關鍵變更

#### 1. `src/telegram.ts` — 簡化訊息流

**Before:** `flushBuffer()` 呼叫 `dispatch()` → triage → Chat/Haiku Lane
**After:** `flushBuffer()` 只做：
  - 寫入 inbox（已有）
  - emit `trigger:telegram-user`（已有）
  - 立即回傳 `👀` reaction（已有）
  - **不再呼叫 `dispatch()`**

訊息透過 perception（`<telegram-inbox>`）進入 OODA context，由 Loop cycle 自然處理並回覆。

回覆機制：Loop cycle 產出的 `[CHAT]` tag 或 telegram reply 透過 `notifyTelegram()` 發送。

#### 2. `src/dispatcher.ts` — 精簡為 tag processor

移除：
- `triageMessage()` — 不再需要 triage
- `callHaiku()` — 不再有 Haiku Lane
- `dispatch()` — 統一入口不再需要
- `SIMPLE_PATTERNS` / `COMPLEX_PATTERNS` — triage regex
- `haikuSem`, `haikuStats`, `claudeStats` — lane 統計
- `getLaneStats()` — lane stats（改為 loop stats）

保留：
- `parseTags()` — tag 解析（loop.ts 共用）
- `postProcess()` — tag 處理 + memory + log（loop.ts 共用）
- `getSystemPrompt()` — system prompt 組裝（loop.ts 共用）
- `Semaphore` class — 可能其他地方用到

#### 3. `src/agent.ts` — 精簡為 LLM execution layer

移除：
- `processMessage()` — Chat Lane 入口
- `processSystemMessage()` — 改為 Loop 直接呼叫 `callClaude()`
- `runHeartbeat()` — 已由 cron 觸發 loop cycle 替代
- Chat Lane busy lock（`chatBusy`, `chatTask`）
- Message Queue（`messageQueue`, `drainQueue()`, `restoreQueue()`）
- Queue persistence（`saveQueueToDisk()`, `getQueueFilePath()`）
- `preemptLoopCycle()` — 不再需要搶佔（只有一條 lane）

保留：
- `callClaude()` — LLM 呼叫核心（loop.ts 的唯一使用者）
- `execClaude()` / `execCodex()` — provider execution
- `classifyError()` — 錯誤分類
- `getProvider()` / `getFallback()` — provider 選擇
- Loop Lane busy lock（`loopBusy`, `loopTask`）— 保留，防止並發 cycle

#### 4. `src/loop.ts` — 擴展為統一處理中心

變更：
- Loop cycle 的 prompt 增加**對話處理模式**：當 `<telegram-inbox>` 有未讀訊息時，優先回覆 Alex
- 回覆透過 `notifyTelegram()` 發送到 TG
- telegram-wake 機制保留（收到 Alex 訊息 → 立刻觸發 cycle）
- Preemption 簡化（不再需要搶佔 loop for chat）

新增邏輯：
```typescript
// cycle() 開始時檢查是否有待回覆的 TG 訊息
const pendingTgMessages = getPendingTelegramMessages(); // 從 inbox 讀取
if (pendingTgMessages.length > 0) {
  // 注入到 prompt 中，要求 Kuro 回覆
  // 回覆透過 [CHAT] tag → notifyTelegram()
}
```

#### 5. `src/api.ts` — 更新端點

- `POST /chat` — 改為寫入 telegram inbox（或移除，Kuro 只透過 TG 對話）
- `GET /status` — 更新 `claude` section（移除 chat/queue，只保留 loop）
- 移除 `getLaneStats()` 相關的 endpoint

#### 6. `src/types.ts` — 清理

移除：
- `TriageDecision` type
- `DispatchRequest` 中的 `onQueueComplete` callback

### 延遲影響分析

| 場景 | 現在 | OODA-Only |
|------|------|-----------|
| 簡單問候 | Haiku <5s | Loop cycle 30-60s |
| 複雜問題 | Chat ~30s | Loop cycle 30-60s |
| Loop 正在跑 | Chat 獨立，不受影響 | 等 cycle 結束 + 新 cycle |
| 快速連續訊息 | 每條獨立回覆 | 3s batch → 下個 cycle 一次回覆 |

**延遲增加但品質提升** — 每條回覆都有完整 context（SOUL、memory、perception、threads）。

### 排隊機制簡化

目前的 message queue（最多 5 則）可以移除。新邏輯：
- Alex 的訊息寫入 inbox（已有）
- 多條訊息在同一個 cycle 中一起處理（`<telegram-inbox>` 會累積）
- 不需要 queue persistence — inbox 就是 persistence

### 回覆機制

目前 Chat Lane 的回覆是 `dispatch()` 的 return value → `telegram.ts` 的 `sendMessage()`。

OODA-Only 的回覆路徑：
1. Loop cycle 讀到 `<telegram-inbox>` 有未讀訊息
2. Kuro 在 OODA cycle 中產出回覆
3. 回覆透過以下方式之一送出：
   - Loop cycle 結果中的 `[CHAT]` tag → `notifyTelegram()`
   - 直接在 cycle prompt 中要求回覆，response 透過 `postProcess()` → 通知
4. 標記 inbox 中的訊息為 `replied`

**關鍵決定：Loop cycle 的回覆如何送到 TG？**

方案 A：用 `[CHAT]` tag（已有機制）
- 優點：不需要新機制
- 缺點：Kuro 需要主動使用 tag，可能忘記

方案 B：新增 `[REPLY]` tag，專門回覆 TG 訊息
- 優點：語義清晰
- 缺點：新增 tag 解析

方案 C：**telegram-wake cycle 的 response 自動發送到 TG**（推薦）
- 當 trigger reason 是 `telegram-user` 時，cycle 的 cleanContent 自動發送到 TG
- 保留 `[CHAT]` 用於主動發訊息（非回覆）
- 優點：零新 tag、自然直覺（cycle 就是回覆）、向後相容
- 缺點：需要區分「回覆 Alex」和「自主行動」的 cycle output

**推薦方案 C** — 最簡潔，且符合「Kuro 是唯一對話者」的設計意圖。

## 實作步驟

1. **telegram.ts** — 移除 `dispatch()` 呼叫，只保留 inbox 寫入 + reaction + event emit
2. **loop.ts** — telegram-wake cycle 結果自動發送到 TG；prompt 加入「回覆 Alex」指引
3. **agent.ts** — 移除 Chat Lane（processMessage, queue, chatBusy）；保留 callClaude + Loop Lane
4. **dispatcher.ts** — 移除 triage/haiku/dispatch；保留 parseTags/postProcess/getSystemPrompt
5. **api.ts** — 更新 /status endpoint；移除或改寫 /chat endpoint
6. **types.ts** — 清理無用 types
7. **測試** — 確認 TG 訊息觸發 cycle → 回覆 → inbox 標記

## Acceptance Criteria

- [ ] Alex 發 TG 訊息 → Kuro 在 OODA cycle 中回覆（有完整 context）
- [ ] 所有回覆都帶有 SOUL + memory + perception
- [ ] Cron 任務正常觸發 cycle
- [ ] 自主學習 cycle 正常運作
- [ ] `pnpm typecheck` 通過
- [ ] `GET /status` 正確反映新架構

## 風險

| 風險 | 緩解 |
|------|------|
| 回覆延遲增加 | telegram-wake 機制確保收到訊息後 <5s 觸發 cycle |
| Loop cycle 失敗 → 無回覆 | callClaude 的 retry 機制保留；失敗時發送錯誤通知 |
| 快速連續訊息 → cycle 堆積 | telegram-wake queue 機制已有（cycle 結束後 drain） |
| Kuro 在 cycle 中忘記回覆 Alex | prompt 明確指引 + trigger reason 提示 |

## Kuro 審查意見（已納入）

1. **回覆機制（方案 C）明確化**：`triggerReason === 'telegram-user'` 時，優先用 `[CHAT]` tag 內容發送；若無 `[CHAT]`，用 `cleanContent` 但排除 `[ACTION]` 區塊
2. **`flushBuffer()` 大幅簡化**：`handleUpdate()` 已經做了 inbox 寫入 + event emit，`flushBuffer()` 的 dispatch 邏輯可以完全移除，只保留 smart batching 的 event emit
3. **`/chat` API 安全移除**：`claude-code-inbox` 檔案機制已替代 `/chat` 的 Claude Code 用途，`/chat` 改為寫 inbox + emit trigger
4. **`cli.ts` interactive mode**：原提案遺漏 — `cli.ts` 的 pipe/file/prompt/interactive mode 都使用 `dispatch()`，需改為直接呼叫 `callClaude()` + `postProcess()`

## 回退方案

C4 可逆性：`git revert` 所有改動即可恢復。改動不涉及資料遷移，純邏輯重構。
