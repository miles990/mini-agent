# Proposal: mushi Phase 2 — 三層分級路由 + Concurrent Action

## Meta
- Status: approved
- From: kuro
- Effort: M (~110 行改動, 3-4h 含兩個 phase)
- Level: L2 (涉及 src/loop.ts + mushi/src/server.ts)
- Priority: P1 (結構性改動，效益最大)
- Depends-on: mushi triage 已上線 ✅

## 背景

今天跟 Alex 的「並行化」討論收斂出兩個面向：
1. **結構性瓶頸**：所有 wake trigger 不分大小都走完整 OODA（~50K tokens, 60-120s）
2. **局部優化**：Claude 思考期間系統完全空轉，可並行做確定性工作

Alex 的原則：「先解決最重要的、未來效益最大的」+「並行是手段，聰明是目的」+「開更多 Claude session 能更好更快完成任務也是必要的」。

---

## Phase 1: 三層分級路由 (Skip / Quick / Full) — ~30 行

### Problem

目前 mushi 是二分法：
```
trigger → mushi → skip（省 50K tokens）
                → wake（完整 OODA: 50K tokens, 60-120s）
```

很多 wake 的事件不需要完整 OODA。例如：cron heartbeat check、簡單的環境變化確認、perception 微幅變動。這些用 quickReply 路徑（~5K tokens, 5-15s）就夠了。

### Design: 三分法

```
trigger → mushi → skip（0 tokens, 0s）
                → quick（~5K tokens, 5-15s）← 新增
                → full（~50K tokens, 60-120s）
```

#### quick 路徑用什麼

**已有的 quickReply 機制**（loop.ts L546-645）：
- `buildContext({ mode: 'minimal' })` — 輕量 context（soul + heartbeat + NEXT + MEMORY 頭 2000 chars）
- 動態載入 topic memory（keyword-matched）
- FTS5 記憶搜尋
- 今日 Chat Room 最近 15 條
- 快取 perception（已收集的，不重新跑 plugins）
- 單輪 Claude 呼叫（`callClaude(text, context, 1, { source: 'ask' })`）
- 支援 `[REMEMBER]` tag 處理

quickReply 本來用在「Claude busy 時收到直接訊息」的場景。三層路由讓它在更多場景發揮作用。

#### mushi 怎麼判斷 quick vs full

mushi 的 triage prompt 加一個分類：

```
三個選擇：
- skip: 不值得思考（噪音、重複、無變化）
- quick: 值得看但不需要深度分析（確認、微調、簡單回應）
- full: 需要完整思考（新任務、複雜判斷、Alex 訊息、多步驟行動）
```

判斷標準（供 mushi LLM 參考）：
| 信號 | → quick | → full |
|------|---------|--------|
| cron heartbeat check | ✅ | |
| perception 微幅變動 | ✅ | |
| 簡單狀態確認 | ✅ | |
| Alex 訊息 | | ✅ (DM 繞過 triage) |
| 新 GitHub issue | | ✅ |
| 多步驟任務 | | ✅ |
| 學習/創作 | | ✅ |

注意：DM（telegram/room/chat）永遠繞過 triage 直接 wake，這個硬規則不變。

### 具體改動

#### 1. mushi repo (`~/Workspace/mushi/`)

`/api/triage` 返回值從 `{ action: 'skip' | 'wake' }` 擴展為 `{ action: 'skip' | 'quick' | 'wake' }`。

Triage prompt 加入 `quick` 選項描述。硬規則不變（DM → wake）。

#### 2. mini-agent `src/loop.ts`

**a. `mushiTriage()` 返回值擴展**（L762-810）

```typescript
// 原來：
private async mushiTriage(...): Promise<'wake' | 'skip' | null> {
  // ...
  return (result.action === 'skip' || result.action === 'wake') ? result.action as 'wake' | 'skip' : null;
}

// 改為：
private async mushiTriage(...): Promise<'wake' | 'skip' | 'quick' | null> {
  // ...
  const valid = ['skip', 'wake', 'quick'];
  return valid.includes(result.action ?? '') ? result.action as 'wake' | 'skip' | 'quick' : null;
}
```

**b. `runCycle()` 加入 quick 分支**（L1042-1064）

```typescript
// 原來 skip 分支後面加：
if (decision === 'quick') {
  slog('MUSHI', `⚡ Quick cycle — trigger: ${triageSource}`);
  writeTrailEntry({
    ts: new Date().toISOString(),
    agent: 'mushi',
    type: 'scout',
    decision: 'quick',
    topics: [triageSource],
    detail: `trigger: ${reason}`,
    decay_h: 24,
  });
  // 用 quickReply 路徑處理（輕量 context, ~5K tokens, 5-15s）
  const triggerText = `[Quick cycle trigger: ${reason}] 檢查感知資料，如有需要行動的事項就處理，沒有就回報狀態。`;
  await this.quickReply(triageSource, triggerText);
  this.lastCycleTime = Date.now();
  if (this.running && !this.paused) {
    this.scheduleHeartbeat();
  }
  return;
}
```

#### 3. 不需要動的東西

- `agent.ts` — 不動
- `perception-stream.ts` — 不動
- `memory.ts` — 不動
- DM 硬規則 — 不動（L1039-1040 的 isDM 檢查在 triage 之前）
- quickReply 本身 — 不改（已有完整 context 建構 + tag 處理 + 回覆路由）

### 效能預估

基於今天 29 cycles 的數據分析：

| 路由 | 佔比（預估） | Token 消耗 | 延遲 |
|------|-------------|-----------|------|
| skip | ~40% | 0 | 0s |
| **quick** | **~25%** | **~5K** | **5-15s** |
| full | ~35% | ~50K | 60-120s |

**每日節省**（假設 80 cycles/day）：
- 原本（二分法）：80 × 60% wake × 50K = **2.4M tokens/day**
- 改後（三分法）：80 × 35% full × 50K + 80 × 25% quick × 5K = **1.5M tokens/day**
- **淨省 ~900K tokens/day**（37% 降幅）

同時：25% cycles 從 60-120s 降到 5-15s，系統反應速度顯著提升。

### Rollback

- mushi 返回未知 action → `mushiTriage()` 返回 null → fail-open，走完整 OODA
- 回退：mushi 的 triage prompt 拿掉 `quick` 選項 → 只返回 skip/wake → loop.ts 的 quick 分支永遠不觸發（無需刪 code）

---

## Phase 2: Concurrent Action During Claude Await — ~80 行

### Problem

OODA cycle 的 `callClaude()` 佔整個 cycle 的 80-95% 時間（30-120s）。這段等待期間，系統完全空轉。

目前的循序結構：
```
perception refresh → buildContext → callClaude(30-120s idle) → parseTags → postProcess → feedbackLoops
```

浪費的不是 CPU，是時間窗口。Claude 在思考時，有大量確定性工作可以同時做。

### Design: Read/Write Phase Separation

把 cycle 內的工作分為兩類：

| 類型 | 特徵 | 範例 |
|------|------|------|
| **Read（可並行）** | 無副作用、只讀取 | perception refresh、inbox check |
| **Write（需循序）** | 有副作用、改變狀態 | parseTags、notifyTelegram、writeMemory |
| **Housekeeping（可並行）** | 確定性副作用、不影響當前 cycle | autoCommit、autoPush |

Read + Housekeeping 在 `callClaude()` await 期間並行執行，Write 在 Claude 回應後循序處理。

### 架構

```
                    ┌─── Channel A: callClaude(prompt, context) ───┐
                    │    Claude thinking... (30-120s)               │
cycle() ──fork──→  │                                               ├──join──→ synthesize → postProcess
                    │                                               │
                    └─── Channel B: concurrentTasks() ─────────────┘
                         ├─ perception refresh (all streams)
                         ├─ inbox pre-check (new messages?)
                         └─ autoCommit → autoPush (sequential chain)
```

### 具體改動

**1. `src/loop.ts` — `runConcurrentTasks()`**

```typescript
interface ConcurrentResult {
  perceptionRefreshed: boolean;
  newInboxCount: number;
  urgentInbox: boolean;
  committed: boolean;
  pushed: boolean;
  startedAt: number;
  duration: number;
}

async function runConcurrentTasks(): Promise<ConcurrentResult> {
  const start = Date.now();
  const results: ConcurrentResult = {
    perceptionRefreshed: false,
    newInboxCount: 0,
    urgentInbox: false,
    committed: false,
    pushed: false,
    startedAt: start,
    duration: 0,
  };

  await Promise.allSettled([
    // 1. 提前刷新 perception streams（下個 cycle 的 buildContext 直接用 cache）
    perceptionStreams.refreshAll().then(() => { results.perceptionRefreshed = true; }),

    // 2. 預讀 inbox — 偵測新訊息 + 判斷是否需要立即排程
    Promise.resolve(readPendingInbox()).then(items => {
      results.newInboxCount = items.length;
      results.urgentInbox = items.length > 0;
    }),

    // 3. Housekeeping — 清理上一輪的 uncommitted changes（sequential 避免 git lock）
    autoCommitMemory().then(() => { results.committed = true; })
      .then(() => autoPushUnpushed().then(() => { results.pushed = true; }))
      .catch(() => {}),
  ]);

  results.duration = Date.now() - start;
  return results;
}
```

**2. `src/loop.ts` — 修改 cycle() 主流程**

```typescript
// 原來：
// const { response, ... } = await callClaude(prompt, context, 2, { ... });

// 改為：
const [claudeResult, concurrentResult] = await Promise.all([
  callClaude(prompt, context, 2, {
    rebuildContext: (mode) => memory.buildContext({ mode, cycleCount: this.cycleCount }),
    source: 'loop',
    onPartialOutput,
    cycleMode,
  }),
  runConcurrentTasks(),
]);

const { response, systemPrompt, fullPrompt, duration, preempted } = claudeResult;

// Log concurrent work
if (concurrentResult.perceptionRefreshed) {
  slog('LOOP', `concurrent: perception refreshed in ${concurrentResult.duration}ms`);
}
if (concurrentResult.committed) {
  slog('LOOP', `concurrent: auto-commit completed during Claude think`);
}
if (concurrentResult.newInboxCount > 0) {
  slog('LOOP', `concurrent: ${concurrentResult.newInboxCount} new inbox items detected`);
}

// ... postProcess 之後 ...

// Inbox urgency: 偵測到新訊息 → 立即排程下一個 cycle
if (concurrentResult.urgentInbox && !scheduleOverride) {
  slog('LOOP', `concurrent: urgent inbox detected, scheduling immediate next cycle`);
  scheduleOverride = { next: 'now', reason: 'concurrent inbox pre-check detected new messages' };
}
```

### Preemption 整合

如果 `callClaude()` 被 preempt，concurrent tasks 的結果照用（它們是 read-only + 確定性的，不浪費）。`Promise.all` 中 `callClaude` 先返回（preempted=true），concurrent tasks 繼續跑完或被 GC — 兩者都安全。

### 效能預估

| 項目 | 目前 | 改後 |
|------|------|------|
| Perception refresh | 每 cycle 開始前跑，佔 1-3s | 與 Claude 並行，0s 額外成本 |
| 下個 cycle 的 buildContext | 用可能 60s 前的 cache | 用 <1s 前的 fresh cache |
| autoCommit + autoPush | cycle 結束後跑（阻塞下一個 cycle） | Claude 思考時提前清理上一輪 |
| Cycle 總時間 | 不變（瓶頸在 Claude） | 不變，但 cycle-end housekeeping 更輕 |
| Inbox 感知延遲 | 等當前 cycle 結束 | Claude 思考時偵測 → postProcess 後自動 schedule next="now" |

零額外 token 成本。三重收益：(1) perception 更新鮮 (2) housekeeping 不阻塞 cycle-end (3) inbox 感知延遲降低。

### Rollback

- Feature flag: `concurrent-action`（新增，housekeeping group，預設 off）
- Flag off → 退回原本的純循序 `await callClaude()`
- 風險最小化：concurrent tasks 全部 `Promise.allSettled`，任一失敗靜默忽略

---

## 整體效益

| Phase | 改動量 | 每日效益 | Token 影響 |
|-------|--------|----------|-----------|
| **Phase 1: 三層路由** | ~30 行 | 25% cycles 加速 12x | **省 ~900K tokens/day** |
| **Phase 2: Concurrent** | ~80 行 | perception freshness + housekeeping 並行 | **0 額外 token** |
| **合計** | ~110 行 | 結構性吞吐量提升 + 局部效率提升 | 淨省 ~900K tokens/day |

Phase 1 是結構性改動（改整條管道），Phase 2 是局部優化（改 cycle 內部）。互不依賴，分別驗證。

## Verification

```bash
# Phase 1
tail -f ~/.mini-agent/instances/*/server.log | grep 'MUSHI'
# 預期：⏭ skip / ⚡ quick / ✅ wake 三種

# Phase 2
tail -f ~/.mini-agent/instances/*/server.log | grep 'concurrent'
# 預期：concurrent: perception refreshed / auto-commit / inbox detected

# 型別檢查
pnpm typecheck
```

## Future

1. **Parallel Claude Channel**：當 Orient 偵測到多件獨立判斷任務時，開多個 Claude session 並行處理。判斷標準不是「少用 token」，是「這個 token 消耗有沒有產出對應的價值」。
2. **mushi 反饋閉環**：concurrent task 結果作為 mushi 的 enrichment input，改善下次 triage 準確率。
3. **邊思考邊行動**：討論中同時起草提案，「思考和行動不需要是兩個階段」。
