# Proposal: Reactive Architecture — 用 RxJS 概念統一改進 mini-agent 全模組

## Status: completed (2026-02-12) — Phase 1-4 全部實作完成

## TL;DR

用 EventEmitter + 手寫 reactive 原語（~200 行 `src/event-bus.ts`）統一改進 mini-agent 的事件流。**不引入 RxJS 庫**，只移植核心概念（Observable stream、distinctUntilChanged、debounce、throttle、merge、scan）。涵蓋 loop（事件驅動）、observability（統一事件匯流排）、perception（細粒度 stream）、dashboard（SSE 即時推送）四個維度。

本 proposal 整合了：
- Kuro 的 327 cycles 數據分析 + `reactive-loop-phase2.md` draft
- Alex 的 RxJS 概念建議（概念移植，不引入 library）
- Claude Code 的 ClawDashboard 設計研究 + 跨模組分析

## Problem（現狀問題）

### 1. 已經是 reactive 的但手工實現

mini-agent 已有大量 reactive pattern，但分散在各處用命令式手工實現：

| RxJS 概念 | 手工實現 | 位置 | 問題 |
|---|---|---|---|
| `distinctUntilChanged` | `lastContextHash` | loop.ts:204 | 粗粒度（全量 hash），只在 loop 用 |
| `debounceTime(3000)` | `batchWaitMs` | telegram.ts:121 | 硬編碼，只 TG 用 |
| `throttleTime` | `autonomousCooldown` | loop.ts:219 | 手動計數器 |
| `concatMap(1)` | `claudeBusy` + queue | agent.ts | 跟其他模組無法組合 |
| `mergeMap(5)` | `Semaphore(5)` | dispatcher.ts:48 | 獨立實現 |
| `catchError → fallback` | Haiku → Claude 降級 | dispatcher.ts:359 | 局部方案 |
| `bufferTime` | `summaryBuffer` | telegram.ts:966 | 手動 flush |

**核心問題：每個模組各自解決類似問題，無法組合、無法統一訂閱。**

### 2. 分散的 Side Effects

目前事件的「產生」和「處理」耦合在一起：

```typescript
// loop.ts — 一個 action 要手動呼叫 5 個不同的 side effect
slog('LOOP', `#${this.cycleCount} ⚡ ${action.slice(0, 100)}`);
logger.logBehavior('agent', 'action.task', action.slice(0, 2000));
await notify(`⚡ ${action}`, 'heartbeat');
await memory.appendConversation('assistant', `[Loop] ${action}`);
// dispatcher.ts、telegram.ts 也有類似的 5 行組合
```

新增任何「訂閱者」（如 Dashboard SSE）都要改所有 emit 點。

### 3. Polling 模型 vs Perception-First 哲學

Kuro 的 327 cycles 數據（2026-02-12）：
- **43% 無行動**，其中 87 次是 0 秒空轉（context 沒變）
- Phase 1 (context hash) 已消除 0 秒空轉
- 但 `buildContext()` 仍然每次跑所有 perception — 沒事件時不該醒來

### 4. Dashboard 30s Polling

現有 dashboard 每 30 秒 fetch 四個 API，無法即時反映狀態變化。ClawDashboard 用 SSE (Server-Sent Events) 實現零延遲推送。如果有統一事件匯流排，SSE 是免費副產品。

## Architecture Overview（架構全景）

```
                        ┌─────────────────────────────────────┐
                        │         src/event-bus.ts            │
                        │     AgentEventBus (EventEmitter)    │
                        │                                     │
  ── Producers ──       │   emit('trigger', ...)              │   ── Subscribers ──
                        │   emit('action', ...)               │
  workspace change ────>│   emit('log', ...)                  │───> Logger (behavior/claude/error)
  telegram msg ────────>│   emit('notification', ...)         │───> Telegram notify
  cron trigger ────────>│                                     │───> Dashboard SSE
  loop cycle result ───>│   Built-in operators:               │───> Loop scheduler
  agent response ──────>│   - debounce(ms)                    │───> server.log (slog)
  system alert ────────>│   - throttle(ms)                    │
                        │   - distinctUntilChanged(hashFn)    │
                        │   - filter(predicate)               │
                        └─────────────────────────────────────┘
```

**核心改變**：從「每個模組直接呼叫 side effects」變為「emit 事件 → subscribers 各自處理」。

## Phase 分法

### Phase 1: Context Hash + 停噪音（✅ 已完成）

由 Kuro 在 commit `d32aa52` 實現。

- `loop.ts` — `buildContext()` 後 MD5 hash 比對，context 沒變就 skip
- `agent-compose.yaml` — docker/ports perception `enabled: false`
- `compose.ts` — perception config 加 `enabled` flag filter

### Phase 2: Event Bus Foundation（L2）

> 整合自 Kuro 的 `reactive-loop-phase2.md` draft + 擴展範圍

**2a. `src/event-bus.ts` — 核心基礎設施**

```typescript
import { EventEmitter } from 'node:events';

// 事件類型
export type AgentEventType =
  // Triggers（驅動 loop cycle）
  | 'trigger:workspace'      // file changes
  | 'trigger:telegram'       // TG 對話結束
  | 'trigger:cron'           // cron 定時任務
  | 'trigger:alert'          // ALERT 級別
  | 'trigger:heartbeat'      // idle fallback
  // Actions（agent 行為）
  | 'action:loop'            // loop cycle 結果
  | 'action:chat'            // chat 回覆
  | 'action:memory'          // 記憶操作
  | 'action:task'            // 任務操作
  // Observations（可觀測性）
  | 'log:info'               // slog 等級
  | 'log:error'              // 錯誤
  | 'log:behavior'           // 行為記錄
  | 'notification:signal'    // 即時通知
  | 'notification:summary'   // 摘要通知
  | 'notification:heartbeat'; // 心跳通知

export interface AgentEvent {
  type: AgentEventType;
  data: Record<string, unknown>;
  timestamp: Date;
}

// Reactive 原語
export function debounce(fn: Function, ms: number): Function { ... }
export function throttle(fn: Function, ms: number): Function { ... }
export function distinctUntilChanged<T>(hashFn: (v: T) => string): (v: T) => boolean { ... }

// Singleton
export const eventBus = new EventEmitter();
eventBus.setMaxListeners(20);
```

**2b. Loop 事件驅動（替換 setInterval）**

- 移除 `scheduleNext()` 的 `setTimeout`
- subscribe `eventBus.on('trigger:*')`
- throttle（最低間隔 60s 防連續觸發）
- idle heartbeat（30min fallback，夜間 00-08 延長到 60min）
- Trigger reason 注入 prompt：`"Triggered by: [workspace] 3 modified files since last cycle"`

**2c. 整合點**

| 模組 | emit | 時機 |
|------|------|------|
| `telegram.ts` | `trigger:telegram` | dispatch 處理完 TG 訊息後 |
| `cron.ts` | `trigger:cron` | cron 任務觸發時 |
| `workspace.ts` | `trigger:workspace` | file change 偵測（debounce 30s） |
| `loop.ts` | `trigger:alert` | context 包含 ALERT 時 |
| `loop.ts` | `trigger:heartbeat` | idle fallback timer |

### Phase 3: Unified Observability（L2）

**3a. 所有 slog/logBehavior/notify 改走 EventBus**

Before:
```typescript
slog('LOOP', `#${n} ⚡ ${action}`);
logger.logBehavior('agent', 'action.task', action);
await notify(`⚡ ${action}`, 'heartbeat');
```

After:
```typescript
eventBus.emit('action:loop', { cycle: n, action, mode: 'task' });
// subscribers 各自處理：
// - slog subscriber → slog('LOOP', ...)
// - behavior subscriber → logger.logBehavior(...)
// - notify subscriber → notify(...)
// - SSE subscriber → push to dashboard clients
```

**3b. Dashboard SSE endpoint**

```typescript
// api.ts
app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const listener = (event: AgentEvent) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  eventBus.on('*', listener);  // 或用 filter 只推送 dashboard 需要的事件
  req.on('close', () => eventBus.off('*', listener));
});
```

Dashboard 前端改用 `EventSource('/api/events')` 取代 `setInterval(fetchAll, 30000)`。

### Phase 4: Fine-grained Perception（L2/L3）

> 這是最大的架構改進，也是風險最高的。建議在 Phase 2-3 穩定後再做。

**概念：每個 perception 是獨立的 stream**

```
workspace$:  interval(60s)  → executePerception('workspace') → distinctUntilChanged
telegram$:   on('trigger:telegram') → immediate
chrome$:     interval(120s) → executePerception('chrome') → distinctUntilChanged
heartbeat$:  interval(30min) → always

               combineLatest → buildContext()
```

**好處：**
- workspace 60s 才檢查一次，不是每個 loop cycle 都跑
- chrome 2min 一次就夠（大部分時候不變）
- 只有變化的 perception 才觸發 context 重組
- context hash 變成 per-perception level 的 distinctUntilChanged

**不急的原因：** Phase 1 的 context hash 已經消除了最明顯的浪費。Phase 4 是進一步的優化，ROI 取決於 perception 執行成本。

## Not Doing（不做清單）

| 不做 | 原因 |
|------|------|
| 引入 RxJS 庫 | 違反零依賴原則，EventEmitter + ~200 行手寫足夠 |
| 改 dispatch 路由邏輯 | 目前 triage regex 夠用，不需要 reactive pipe |
| 改 Telegram 處理流程 | TG 已有完善的 batch + dispatch 路徑 |
| File watcher（chokidar） | 加依賴，macOS FSEvents edge cases。先用 git diff polling |
| Backpressure 機制 | 個人 agent 不需要，EventEmitter 的無限 buffer 足夠 |

## Effort & Risk

| Phase | Effort | Risk | 獨立可驗證 |
|-------|--------|------|-----------|
| Phase 2a（event-bus.ts） | Small | Low | emit/subscribe 測試 |
| Phase 2b（loop event-driven） | Medium | Medium | cycle 總數、action rate 比較 |
| Phase 2c（整合 telegram/cron） | Small | Low | behavior log 出現 trigger reason |
| Phase 3a（統一 observability） | Medium | Low | 舊 slog/log 行為不變 |
| Phase 3b（Dashboard SSE） | Small | Low | 開 dashboard 看即時更新 |
| Phase 4（perception stream） | Large | Medium | per-perception 執行頻率和 cache hit rate |

**總 Effort: Large（但分 4 phase，每 phase 獨立可交付）**

## Migration Path（漸進式遷移）

```
Phase 2a → Phase 2c → Phase 2b → Phase 3a → Phase 3b → Phase 4
  新增      整合點      替換 loop    統一 log     SSE       感知優化
  event-bus  TG/cron    setInterval  slog→emit   dashboard  per-perception
  (純加法)   (純加法)    (替換)       (替換)       (純加法)    (重構)
```

每個 phase 之間可以有任意時間間隔。Phase 2a/2c 是純加法，不改現有行為。Phase 2b 是第一個真正的替換。

## Acceptance Criteria

1. Phase 2 完成後：loop cycle 由事件驅動觸發，behavior log 記錄 trigger reason
2. Phase 3 完成後：Dashboard 用 SSE 即時更新，不再 30s polling
3. Phase 4 完成後：每個 perception 獨立 interval，context 組裝只用變化的部分
4. 全程零新外部依賴
5. `pnpm typecheck` 和 `pnpm test` 通過

## Source

- Kuro 的 327 cycles 數據分析（43% no-action, 87 次 0 秒空轉）
- Kuro 的 `reactive-loop-phase2.md` draft proposal
- Alex 的 RxJS 概念建議
- ClawDashboard (github.com/Ry7no/ClawDashboard) — SSE 即時更新、Event Bus 設計
- Kuro SOUL.md Architecture Refinement: P1→P2→P3→P4→P5 優先順序
