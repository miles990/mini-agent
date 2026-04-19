# Guardrails First — 護欄優先於器官

## Context

2026-04-19 修復 Kuro 186 cycle noop spiral。根因是 4 個簡單 bug（regex / 持久化毒資料 / HEARTBEAT 垃圾 / prescription prompt），不是架構缺陷。Organ Architecture（KG / Decision Tree / Middleware 器官化）是未來方向，但現在最需要的是**讓同類問題在第 5 cycle 就被發現，不是第 186 cycle**。

## Principle

護欄 = code guard，不是 prompt 提醒。Kuro 讀到 prompt 提醒沒有清掉垃圾反而複製保留（HEARTBEAT 教訓）。**確定性防線必須是 code。**

## Implementation DAG

| id | action | executor | dependsOn | convergence condition |
|----|--------|----------|-----------|----------------------|
| A1 | noop streak alert — Telegram 告警 | CC | — | noopStreak > 5 自動發 Telegram，不靠 prompt |
| A2 | HEARTBEAT size guard — context 污染早期預警 | CC | — | HEARTBEAT > 150 行 → slog warning + trim 提醒 |
| A3 | lastAutonomousActions poison gate — 自動清空 | CC | — | 全部是 "no action" → 清空 array，不注入 prompt |
| A4 | empty response alert — Claude 回空白告警 | CC | — | response length = 0 → slog + 不算 action |
| B1 | Decision Tree routing module | CC | — | noopStreak >= 3 不降 context；inbox priority flag |
| B2 | noop streak 不降 context（移除 light context 強制） | CC | — | noopStreak >= 3 保持 full context，不 strip |
| C1 | wire A1-A4 + B1-B2 into loop.ts | CC | A1-A4, B1-B2 | 所有 guard 在 cycle 中生效 |
| C2 | 驗證 — 觀察 20 cycle | Alex | C1 | 0 noop spiral + 告警在 5 cycle 內觸發 |

A1-A4 和 B1-B2 全部可並行。關鍵路徑 = 3 步。

---

## A1: Noop Streak Alert

**File:** `src/loop.ts` (cycle 結束的 bookkeeping 段)

**Logic:**
```typescript
// After noopStreak increment (existing code ~line 2374)
if (this.noopStreak === 5) {
  notifyTelegram(`⚠️ noopStreak = ${this.noopStreak} — 連續 ${this.noopStreak} cycle 無可見產出`);
}
if (this.noopStreak === 10) {
  notifyTelegram(`🚨 noopStreak = ${this.noopStreak} — 可能進入 noop spiral`);
}
```

**Why 5 not 3:** 3 次 noop 可能是正常等待（等 delegate 結果）。5 次開始不正常。10 次是紅線。

**Convergence condition:** Alex 在 Telegram 看到告警 → 有機會介入，不會再等 186 cycle。

---

## A2: HEARTBEAT Size Guard

**File:** `src/cycle-tasks.ts` (already handles HEARTBEAT processing)

**Logic:**
```typescript
const heartbeatPath = path.join(process.cwd(), 'memory', 'HEARTBEAT.md');
const lines = fs.readFileSync(heartbeatPath, 'utf-8').split('\n').length;
if (lines > 150) {
  slog('HEARTBEAT', `⚠️ HEARTBEAT.md has ${lines} lines (threshold: 150) — possible context pollution`);
}
if (lines > 250) {
  notifyTelegram(`🚨 HEARTBEAT.md 膨脹到 ${lines} 行，可能被垃圾污染`);
}
```

**Why 150/250:** 清理後是 101 行。150 = 正常成長上限。250 = 肯定被污染。

**Convergence condition:** HEARTBEAT 膨脹在早期被發現，不會重演 277 行垃圾事件。

---

## A3: lastAutonomousActions Poison Gate

**File:** `src/prompt-builder.ts` (already has NO_ACTION_RE filter)

**Already done in this session.** Filter in place:
```typescript
const NO_ACTION_RE = /^no action|minimal-retry streak/i;
const meaningfulActions = lastAutonomousActions.slice(-3)
  .filter(a => !NO_ACTION_RE.test(a.trim()))
  .map(a => a.length > 500 ? a.slice(0, 500) + '…' : a);
```

**Additional guard — auto-clear in loop.ts:**
```typescript
// After noopStreak bookkeeping
const allNoop = this.lastAutonomousActions.every(a => NO_ACTION_RE.test(a.trim()));
if (allNoop && this.lastAutonomousActions.length > 0) {
  slog('LOOP', `Clearing ${this.lastAutonomousActions.length} poisoned lastAutonomousActions`);
  this.lastAutonomousActions = [];
}
```

**Convergence condition:** 毒資料不再跨 cycle 累積。prompt 不會注入 "no action" 文字。

---

## A4: Empty Response Alert

**File:** `src/loop.ts` (after Claude CLI call returns)

**Logic:**
```typescript
// After receiving Claude response (existing postProcess area)
if (!response || response.trim().length === 0) {
  slog('LOOP', `#${this.cycleCount} ⚠️ Claude returned empty response`);
  // Don't count as action, don't update lastAction
  this.noopStreak++;
  return; // skip postProcess
}
```

**Why this matters:** 今天看到 `responseLength: 0` 的 Claude 回應 — Claude 回了空白但 cycle 照樣跑完，浪費整個 cycle。

**Convergence condition:** 空回應被立即標記，不進入 postProcess，不污染 lastAction。

---

## B1: Decision Tree Routing Module

**File:** `src/decision-tree.ts` (new, ~150 lines)

**Design:** 不是完整的 Decision Tree engine，就是一組 deterministic guards。

```typescript
export interface RouteDecision {
  route: 'full-context' | 'current'; // full-context = 不降級
  priorityFlags: string[];           // 注入 cycle prompt 的 priority hints
  skipClaude: boolean;               // 未來用：確定性任務跳過 Claude
  reason: string;
}

export function routeCycle(state: {
  noopStreak: number;
  hasUnreadInbox: boolean;
  triggerReason: string;
  lastResponseEmpty: boolean;
  hasPendingTasks: boolean;
}): RouteDecision {

  // Rule 1: noop spiral prevention
  if (state.noopStreak >= 3) {
    return {
      route: 'full-context',
      priorityFlags: ['noop-recovery'],
      skipClaude: false,
      reason: `noopStreak=${state.noopStreak} — force full context`,
    };
  }

  // Rule 2: inbox priority
  if (state.hasUnreadInbox) {
    return {
      route: 'full-context',
      priorityFlags: ['inbox-first'],
      skipClaude: false,
      reason: 'unread inbox — prioritize reply',
    };
  }

  // Rule 3: last response was empty — something is wrong
  if (state.lastResponseEmpty) {
    return {
      route: 'full-context',
      priorityFlags: ['empty-response-recovery'],
      skipClaude: false,
      reason: 'last Claude response was empty — retry with full context',
    };
  }

  // Default: current behavior
  return {
    route: 'current',
    priorityFlags: [],
    skipClaude: false,
    reason: 'normal routing',
  };
}
```

**Convergence condition:** deterministic decisions 由 code 處理，不依賴 prompt。noopStreak >= 3 不再降 context。

---

## B2: Remove Light Context Forcing

**File:** `src/loop.ts` (~line 1648)

**Current code (problematic):**
```typescript
const contextMode = this.noopStreak >= 3 ? 'light' : rawContextMode;
```

**New code:**
```typescript
const decision = routeCycle({
  noopStreak: this.noopStreak,
  hasUnreadInbox: inboxItemsEarly.length > 0,
  triggerReason: this.triggerReason ?? '',
  lastResponseEmpty: this.lastResponseEmpty,
  hasPendingTasks: /* existing check */,
});

// Decision Tree overrides: noop → full context (never degrade)
const contextMode = decision.route === 'full-context' ? rawContextMode : rawContextMode;
// Remove the old noopStreak >= 3 → 'light' logic entirely
```

**Why:** `noopStreak >= 3 → light context` 是 noop spiral 的直接放大器。設計意圖是「打破自我反省迴圈」但實際效果是砍掉 identity → 更多 noop。

**Convergence condition:** noop streak 時 Kuro 保持完整 context，有能力行動。

---

## C1: Wiring

All guards integrated into loop.ts cycle flow:

```
cycle start
  → A3 check (clear poisoned lastAutonomousActions)
  → B1 routeCycle() (determine context mode + priority flags)
  → B2 context mode (never degrade on noop)
  → buildContext() with priority flags
  → Claude CLI call
  → A4 check (empty response → slog + skip)
  → postProcess
  → A1 check (noopStreak alert at 5/10)
  → A2 check (HEARTBEAT size guard)
cycle end
```

---

## C2: Verification

觀察 20 cycle 後檢查：

- [ ] noopStreak 沒超過 5（如果超過，告警有在 Telegram 出現）
- [ ] HEARTBEAT 行數穩定在 100-130 之間
- [ ] lastAutonomousActions 沒有 "no action" 類文字
- [ ] 沒有 empty Claude response 被忽略
- [ ] Kuro 有可見產出（chat / commit / delegate / done）

---

## What This Does NOT Include (Future)

- KG Organ — 等護欄穩定後再加 enrichment
- Middleware default routing — BAR 已 landed，incremental 改進
- Adaptive feedback loop — 等 Decision Tree routing 穩定後再加 confidence
- KG data quality layers — 等有 KG Organ 時再做

**順序：護欄 → Decision Tree → KG read → KG write → Middleware default**
