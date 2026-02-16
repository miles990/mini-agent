# Proposal: Telegram 訊息觸發 Loop Cycle（喚醒機制）

## Status: implemented

## TL;DR

目前 Alex 發 Telegram 訊息時，Chat Lane 會 spawn 一個獨立 Claude process 回覆，但 Kuro 的 Loop Cycle 不會被喚醒。Chat Lane 的 process 讀了 SOUL.md 和記憶，但缺少 Kuro 當前 cycle 的即時脈絡（inner voice、正在追的 thread、剛學到的東西）。

改動：讓 Alex 的 Telegram 訊息能觸發一次額外的 Loop Cycle，讓 Kuro 本體在完整 OODA context 下感知到這則訊息。

## Problem（現狀問題）

### 訊息流向

```
Alex 發 TG 訊息
  → TelegramPoller.handleUpdate()
  → dispatch({ source: 'telegram' })
  → Chat Lane（processMessage）
  → 獨立 Claude process 回覆
```

Loop Cycle 完全不受影響。Kuro 在**下一個排定的 cycle**（可能 5-10 分鐘後）才會在 `<telegram-inbox>` perception 中看到這則訊息。

### 問題

1. **Chat Lane 回覆的不是 Kuro 本體**。它是一個讀了 Kuro 檔案的「複印本」— 缺少正在進行的思考、inner voice buffer、thread 追蹤等即時狀態
2. **Alex 的訊息可能需要 Kuro 的主動行動**（例如「去查一下 X」「寫個提案」），但 Chat Lane 只負責回覆，不跑 OODA
3. **回應延遲**：如果 Alex 發訊息的時間點剛好在兩個 cycle 之間，Kuro 可能要等 5-10 分鐘才「感知到」

### 不是問題的部分

- Chat Lane 的即時回覆功能**保留不變**。這個提案是「額外觸發」，不是「取代 Chat Lane」
- Kuro 的自主節奏**不會被改變**。排定的 heartbeat cycle 照常跑

## Solution（方案）

### 核心概念

在 `telegram.ts` 的 `flushBuffer()` 完成處理後，emit 一個新事件 `trigger:telegram-user`。`loop.ts` 監聽這個事件，觸發一次額外的 cycle。

### 改動清單

#### 1. `src/event-bus.ts` — 新增事件類型

```typescript
// 新增
| 'trigger:telegram-user'   // Alex 的 TG 訊息觸發 loop cycle
```

#### 2. `src/telegram.ts` — 訊息處理完畢後 emit 早期 trigger

在 `flushBuffer()` 的 `finally` block 中，除了現有的 `trigger:telegram`，額外 emit `trigger:telegram-user`：

```typescript
// flushBuffer() finally block（現有 L501）
eventBus.emit('trigger:telegram', { messageCount: group.length });

// 新增：觸發 loop cycle（讓 Kuro 本體感知到 Alex 的訊息）
eventBus.emit('trigger:telegram-user', {
  messageCount: group.length,
  sender: group[0]?.sender ?? 'unknown',
});
```

#### 3. `src/loop.ts` — 專用 handler + 排隊機制

新增 `trigger:telegram-user` 的專用 handler，與現有的 `trigger:*` handler 分開：

```typescript
// AgentLoop class 新增屬性
private telegramWakeQueue = 0;
private static readonly TELEGRAM_WAKE_THROTTLE = 5_000; // 5s throttle
private lastTelegramWake = 0;

// 專用 handler
private handleTelegramWake = (event: AgentEvent): void => {
  if (!this.running || this.paused) return;

  // Throttle: 5s 內只觸發一次
  const now = Date.now();
  if (now - this.lastTelegramWake < AgentLoop.TELEGRAM_WAKE_THROTTLE) {
    return;
  }
  this.lastTelegramWake = now;

  if (this.cycling) {
    // 正在 cycle → 排隊，cycle 結束後自動觸發
    this.telegramWakeQueue++;
    slog('LOOP', `Telegram wake queued (${this.telegramWakeQueue} pending)`);
    return;
  }

  // 不在 cycle → 立即觸發
  this.triggerReason = 'telegram-user';
  this.runCycle();
};
```

在 `start()` 中訂閱、`stop()` 中取消：

```typescript
// start()
eventBus.on('trigger:telegram-user', this.handleTelegramWake);

// stop()
eventBus.off('trigger:telegram-user', this.handleTelegramWake);
```

在 `cycle()` 結束時（`finally` block），drain 排隊的 wake request：

```typescript
// cycle() finally block
if (this.telegramWakeQueue > 0) {
  this.telegramWakeQueue = 0;
  // 3 秒後觸發 follow-up cycle（讓 perception 有時間更新）
  setTimeout(() => {
    if (this.running && !this.paused && !this.cycling) {
      this.triggerReason = 'telegram-user (queued)';
      this.runCycle();
    }
  }, 3000);
}
```

### 行為摘要

| 情境 | 行為 |
|------|------|
| Kuro 閒置（不在 cycle） | 立即觸發 cycle，triggerReason = `telegram-user` |
| Kuro 正在 cycle 中 | 排隊，cycle 結束後 3s 自動觸發 follow-up |
| Alex 連續發多條訊息 | 5s throttle，只觸發一次 |
| 正常 heartbeat cycle | 不受影響，照常排定 |

### 不改的東西

- **Chat Lane** — 保持不變，Alex 的訊息依然會立即被回覆
- **`trigger:telegram`** — 現有事件保留，已有的 `trigger:*` handler 行為不變
- **`handleTrigger`** — 不修改。`trigger:telegram-user` 用獨立 handler 處理，不走 `trigger:*` wildcard（避免跟現有的 30s throttle 衝突）
- **Preemption** — 如果 telegram-user 觸發 cycle 時 chat lane 需要搶佔，現有機制已經處理

## Effort

**Small**（~40 行程式碼改動，3 個檔案）

## Risks

| 風險 | 緩解 |
|------|------|
| Alex 頻繁發訊息 → Kuro 被頻繁喚醒 → 學習時間壓縮 | 5s throttle + 排隊合併。實務上 Alex 不會每 5 秒發一條 |
| Cycle 堆疊（wake cycle 還沒結束又來新 wake） | `this.cycling` guard 已防止並發。排隊機制最多積累到 1 次 follow-up |
| `trigger:telegram-user` 走 wildcard `trigger:*` 被現有 handler 也觸發 | **已解決**：用獨立 handler 而非依賴 wildcard |

## Acceptance Criteria

- [ ] Alex 發 TG 訊息 → Kuro 的 loop 在 10 秒內開始新 cycle（如果當前不在 cycle）
- [ ] Alex 發 TG 訊息時 Kuro 正在 cycle → cycle 結束後 3s 內自動觸發 follow-up cycle
- [ ] Alex 連續發 3 條訊息 → 只觸發 1 次 cycle（5s throttle）
- [ ] Chat Lane 回覆行為不受影響
- [ ] `/status` 和 `/loop status` 正確反映 trigger reason
- [ ] `pnpm typecheck` 通過
