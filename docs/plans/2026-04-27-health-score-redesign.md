# Health Score 重設計 — 從 placeholder 到即時信號

## 方向

基於 KG 討論 86b95287 共識：用 pulse.ts 的持久化信號 + reactive-policies 即時數據，替換 placeholder 寫死值。

pulse-state.json 已有 20-tick 滑動窗口的 recentOutputFlags, recentDecisionScores, errorPatterns, signalHistory — 直接用，不重複計算。

## DAG Plan

| id | 動作 | 執行者 | dependsOn | 完成條件 |
|----|------|--------|-----------|----------|
| A1 | pulse.ts 新增 `getHealthSignals()` — 從 pulse state 提取 health 維度 | CC | — | exports function, build pass |
| A2 | api.ts 重寫 `/api/dashboard/health` — 用 pulse signals + reactive-policies + 當天 task 數據 | CC | A1 | 回傳即時 score, 非 placeholder |
| A3 | activity-monitor.html 改 health 顯示 — 加維度分解 tooltip | CC | A2 | hover 顯示各維度分數 |
| Z1 | build pass | CC | A2 | tsc --noEmit 零錯誤 |
| Z2 | Akari review | Akari | Z1 | approved |
| Z3 | commit + push | CC | Z2 | main updated |

## Module Specs

### A1: pulse.ts 新增 `getHealthSignals()`

從已持久化的 pulse-state.json 讀取，不需要重算：

```typescript
export interface HealthSignals {
  visibleOutputRate: number;     // 0-1, from recentOutputFlags (20-tick window)
  errorPatternCount: number;     // from errorPatterns
  momentumStreak: number;        // from signalHistory
  decisionQuality: number;       // avg of recentDecisionScores
  cycleCount: number;            // total cycles
}

export function getHealthSignals(): HealthSignals;
```

實作：讀 pulse-state.json（已有 `loadPulseState()`），提取各欄位。

### A2: api.ts 重寫 health endpoint

新公式（5 個實際信號，Akari 建議權重）：

```typescript
// 從 pulse
const signals = getHealthSignals();

// 從 reactive-policies
const reactive = onSchedulerTick(null);  // dry-run: 不改狀態，只檢查
const starvation = Math.min(reactive.starvedTasks.length / 5, 1);

// 從當天 task data
const todayStart = new Date().toISOString().slice(0, 10);
const todayCompleted = queryMemoryIndexSync(mDir, { type: ['task','goal'], status: ['completed','done'] }).filter(t => t.ts >= todayStart).length;
const todayAbandoned = queryMemoryIndexSync(mDir, { type: ['task','goal'], status: ['abandoned'] }).filter(t => t.ts >= todayStart).length;
const completionRate = (todayCompleted + todayAbandoned) > 0 
  ? todayCompleted / (todayCompleted + todayAbandoned) : 0.5;

// 從 scheduler
const noopRate = signals.cycleCount > 0 
  ? 1 - signals.visibleOutputRate : 0;

// Error rate from pulse
const errorRate = Math.min(signals.errorPatternCount / 10, 1);

// Pressure: queue depth / throughput
const procs = getProcessTableSnapshot();
const queueDepth = procs.filter(p => ['pending','scheduled','suspended'].includes(p.state)).length;
const pressure = Math.min(queueDepth / 10, 1);

// Score
score = Math.round(
  completionRate * 25 +
  (1 - noopRate) * 15 +
  (1 - errorRate) * 15 +
  (1 - pressure) * 25 +
  (1 - starvation) * 20
);
```

回傳增加 breakdown：
```json
{
  "score": 72,
  "breakdown": {
    "completion": { "value": 0.8, "weight": 25, "contribution": 20 },
    "activity": { "value": 0.7, "weight": 15, "contribution": 10.5 },
    "stability": { "value": 0.9, "weight": 15, "contribution": 13.5 },
    "pressure": { "value": 0.3, "weight": 25, "contribution": 17.5 },
    "fairness": { "value": 0.5, "weight": 20, "contribution": 10 }
  },
  "anomalies": ["high-noop"]
}
```

### A3: activity-monitor.html 改 health 顯示

Health Score box 加 hover tooltip 顯示 5 維度分解：
```
Health Score: 72
─────────────
Completion  ████████░░ 80%  (×25)
Activity    ███████░░░ 70%  (×15)
Stability   █████████░ 90%  (×15)
Pressure    ███░░░░░░░ 30%  (×25)
Fairness    █████░░░░░ 50%  (×20)
```
