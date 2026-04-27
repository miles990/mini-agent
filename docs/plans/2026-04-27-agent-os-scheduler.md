# Agent OS Scheduler — 完整計劃

## 定位

mini-agent = autonomous OS。底層資源管理和排程由 deterministic code 負責，LLM 負責執行和創造性決策。

## 設計原則

- **OS 是靈感，不是藍圖** — 每個子系統都要過 agent impedance mismatch 測試
- **一次一刀** — 每加一層都要證明上一層在工作
- **loop.ts LOC 遞減** — 每 phase 從 loop.ts 抽出邏輯，不是堆疊新邏輯
- **routing ≠ scheduling** — event-router.ts 不動，新 scheduler.ts 在更高層做 task 排序

## DAG Plan

| id | 動作 | 執行者 | dependsOn | 完成條件 |
|----|------|--------|-----------|----------|
| A1 | 新增 `src/scheduler.ts` — SchedulerPolicy + DefaultScheduler | CC | — | exports decideNext(), unit test pass |
| A2 | 擴展 `src/cycle-state.ts` — Minimal PCB (SuspendCheckpoint) | CC | — | saveSuspendCheckpoint / loadSuspendCheckpoint work |
| A3 | 新增 `src/process-table.ts` — ProcessTable + lifecycle | CC | A1 | task registry CRUD + state machine transitions |
| A4 | 新增 `src/context-budget.ts` — Context Budget Manager | CC | — | allocateBudget() + pressureCheck() exports |
| B1 | loop.ts 整合 scheduler — cycle 開頭 call scheduler.pick() | CC | A1, A2 | loop.ts 使用 scheduler 決定 current task |
| B2 | prompt-builder.ts 整合 — 注入 `<current-task>` section | CC | B1 | prompt 包含 scheduler 選擇的 task |
| B3 | loop.ts 整合 process-table — lifecycle management | CC | A3, B1 | process states 正確轉換 |
| B4 | loop.ts 整合 context-budget — PCT trimming | CC | A4, B1 | context 按 budget 分配 |
| C1 | TypeScript build pass | CC | B1-B4 | `bun run build` 零錯誤 |
| C2 | Akari review | Akari | C1 | Akari 確認無問題或修復她的建議 |
| C3 | commit + push | CC | C2 | git push 成功 |

## Module Specs

### src/scheduler.ts (~150 lines)

```typescript
interface SchedulingDecision {
  taskId: string | null;
  reason: string;
  action: 'continue' | 'switch' | 'discovery' | 'idle';
}

interface TaskSnapshot {
  id: string;
  summary: string;
  status: string;
  priority: number;
  source: 'alex' | 'kuro' | 'system' | 'discovery';
  createdAt: string;
  ticksSpent: number;
}

interface SchedulerState {
  currentTaskId: string | null;
  ticksOnCurrent: number;
  totalTicks: number;
  lastDiscoveryTick: number;
}

interface SchedulerPolicy {
  decideNext(tasks: TaskSnapshot[], state: SchedulerState, events: IncomingEvent[]): SchedulingDecision;
}
```

Rules (deterministic):
1. source === 'alex' → P0 鎖定，不可被非 P0 搶佔
2. current task 未 done/blocked → continue（task binding）
3. P0 event 進來 → suspend current, switch to P0
4. ticksSpent > ATTENTION_BUDGET → force checkpoint, re-evaluate
5. totalTicks % DISCOVERY_INTERVAL === 0 → discovery slot
6. 否則 → stack rank by (priority ASC, age DESC)

### src/cycle-state.ts 擴展 — Minimal PCB

```typescript
interface SuspendCheckpoint {
  taskId: string;
  suspendedAt: string;
  reason: 'preempted' | 'attention_budget' | 'blocked' | 'manual';
  resumeHints: string;      // LLM-readable context
  priorityAtSuspend: number;
}
```

### src/process-table.ts (~200 lines)

```typescript
type ProcessState = 'pending' | 'running' | 'blocked' | 'suspended' | 'completed' | 'abandoned';

interface ProcessEntry {
  taskId: string;
  state: ProcessState;
  priority: number;
  source: 'alex' | 'kuro' | 'system' | 'discovery';
  ticksSpent: number;
  createdAt: string;
  lastActiveAt: string;
  checkpoint: SuspendCheckpoint | null;
  blockedBy: string | null;
}

interface ProcessTable {
  register(task: TaskSnapshot): ProcessEntry;
  transition(taskId: string, to: ProcessState, reason?: string): void;
  getCurrent(): ProcessEntry | null;
  getByState(state: ProcessState): ProcessEntry[];
  detectStarvation(threshold: number): ProcessEntry[];
}
```

### src/context-budget.ts (~200 lines)

```typescript
interface SectionBudget {
  name: string;
  maxTokens: number;
  priority: number;   // lower = more important
  currentTokens: number;
}

interface BudgetAllocation {
  sections: SectionBudget[];
  totalBudget: number;
  pressure: number;  // 0.0 - 1.0
  trimmed: string[]; // sections that were trimmed
}

function allocateBudget(sections: SectionInput[], totalBudget: number, currentTaskPriority: number): BudgetAllocation;
function pressureCheck(currentUsage: number, maxBudget: number): { level: 'normal' | 'warning' | 'critical'; action: string };
```

### loop.ts 改動摘要

- Cycle 開頭：`const decision = scheduler.decideNext(tasks, state, events)`
- 根據 decision.action 決定 prompt 內容
- Suspend/resume 邏輯用 PCB
- 抽出 task 選擇相關邏輯到 scheduler.ts（目標 -200 行）

### prompt-builder.ts 改動摘要

- 新增 `<current-task>` section：scheduler 選的 task + resume hints
- context-budget 整合：section 按 budget 分配
