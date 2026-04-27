# Work Pipeline 統一化 + Quality Gate + 自主決策

## 方向

基於 KG 討論 9c813deb 共識 + Akari review 修正：
work routing + quality assurance 不該依賴 work 來源。統一管線。

## DAG Plan（Akari review 修正版）

| id | 動作 | 執行者 | dependsOn | 完成條件 |
|----|------|--------|-----------|----------|
| A1 | 新增 `src/work-router.ts` — 合併 classifier + runtime escalation | CC | — | exports classifyWork() + RuntimeEscalation, build pass |
| A2 | loop.ts 整合 — executeForegroundCall 加 work router hook | CC | A1 | upfront classify + runtime promote 都接上 |
| B1 | 新增 `src/quality-gate.ts` — pipeline 架構 output gate | CC | — | exports qualityCheck() with pluggable check[], build pass |
| B2 | loop.ts 整合 — foreground + OODA deliver 前跑 qualityCheck | CC | B1, A2 | 所有 output 過 gate |
| C1 | scheduler.ts 加 hold task 解鎖邏輯 — machine-evaluable predicates | CC | — | hold tasks 有可執行的 unblock condition |
| C2 | 解鎖/清理現有 9 個 hold tasks | CC | C1 | hold → pending/deleted（依實際狀態） |
| D1 | CLAUDE.md 加自主決策規則 + 品質門檻 | CC | — | 規則寫入 |
| D2 | 通知 Kuro sync 新規則 | CC | D1 | room message sent |
| Z1 | TypeScript build pass | CC | A2,B2,C1 | `tsc --noEmit` 零錯誤 |
| Z2 | Akari review | Akari | Z1 | approved |
| Z3 | commit + push | CC | Z2 | main branch updated |

## Module Specs

### A1: src/work-router.ts (~80 lines)

Akari 修正：classifier + escalation 合併，是同一個 routing 決策的兩個時機。

```typescript
type WorkClass = 'quick-reply' | 'task-worthy' | 'urgent';

interface ClassifyResult {
  workClass: WorkClass;
  hasStateMutation: boolean;
  estimatedLatency: 'fast' | 'medium' | 'slow';
}

function classifyWork(message: string, source: string): ClassifyResult;
```

Upfront classify:
- `urgent`: source=alex + P0/urgent/ASAP
- `task-worthy`: state-mutation intent (implement/fix/build/refactor/deploy/create) OR estimated slow (length > 200 + multi-step indicators)
- `quick-reply`: everything else

```typescript
class RuntimeEscalation {
  private startTime: number;
  private mutationDetected = false;
  private stepCount = 0;
  private promoted = false;

  onToolCall(toolName: string): void;
  shouldPromote(): boolean;
  promote(source: string, text: string, memoryDir: string): string;
  reset(): void;
}
```

Runtime escalation 雙軌（Akari/Kuro 修正）:
1. **Elapsed > 30s** → promote
2. **State-mutation detected**: tool call is Write/Edit/Bash with mutation → promote
3. **Safety net**: step > 10 → force promote（不管什麼情況）

Promote action:
1. appendMemoryIndexEntry (type='task', status='in_progress', source='room-promoted')
2. registerProcess() in process table
3. Return taskId, caller 回 room 通知

Metrics logging（rollback plan）:
每次 promote 記錄 `{ reason, elapsed, stepCount, hadMutation, source }` → 可回頭分析 false positives。

### B1: src/quality-gate.ts (~60 lines)

Pipeline 架構（Akari 修正）：

```typescript
interface QualityCheck {
  name: string;
  check(output: string, context: QualityContext): { pass: boolean; reason: string };
}

interface QualityContext {
  source: string;
  inputLength: number;
  isCode: boolean;
  lane: 'foreground' | 'ooda';
}

interface QualityCheckResult {
  pass: boolean;
  issues: string[];
}

function qualityCheck(output: string, context: QualityContext): QualityCheckResult;
```

MVP hard floor checks（pipeline 中的 check[]）:
1. **Non-empty**: output.trim().length > 10
2. **No error leak**: no raw stack traces / rate limit messages
3. **No XML residue**: no residual action tags leaked to user (extract existing logic from loop.ts L810)
4. **No TODO placeholder**: no `TODO`, `FIXME`, `PLACEHOLDER` in code outputs
5. **Structural match**: if caller expects JSON, output parses as JSON（預留 hook）

預留 hook point for future:
- Type check / lint pass (for code outputs)
- Cross-persona review
- Format validation

### C1: Hold task unblock — machine-evaluable predicates

Akari 修正：純文字 "v0 ships" 不行，scheduler 沒法 eval。

```typescript
interface HoldCondition {
  type: 'task-completed' | 'file-exists' | 'command-succeeds' | 'date-after' | 'manual';
  value: string;
}
```

Evaluator:
- `task-completed`: queryMemoryIndex for taskId, check status === 'completed'
- `file-exists`: fs.existsSync(value)
- `command-succeeds`: exec(value) returns 0
- `date-after`: new Date() >= new Date(value)
- `manual`: only via explicit command

Scheduler checks hold tasks every 10 ticks.

Migration: 現有 9 個 "hold until v0 ships" → 轉為 `{ type: 'task-completed', value: 'idx-62e79a55' }` 或根據實際狀態直接 unblock/delete。

### D1: CLAUDE.md rules

```markdown
### Autonomous Decision Making + Quality Bar
- 深思熟慮過、有收斂條件、可 revert → 直接做，不等授權
- 只有真正無法決定的才 escalate to Alex
- 品質門檻：交出的必須是品質最好、視覺化最好、最正確的成品
- 不交半成品：功能未完整、UI 未收口、edge case 未處理 = 不交
- 品質三問：這是我能做到的最好嗎？使用者看到會滿意嗎？有沒有遺漏的 edge case？
- 至少達到自己心目中 90 分水準才交付檢視
```

## 性質

這是持續性改進，不是一次性工作。Phase 1 先建基礎管線，之後持續迭代：
- 根據 promote metrics 調整 threshold
- 根據 quality gate rejection 率調整 checks
- 根據使用者回饋擴展 gate pipeline

## 延後項目

- Review gate (cross-persona review) — Phase 2
- Full WorkDispatcher 統一管線 — 先用 runtime escalation 證明有效
- Auto-crystallization from quality gate rejections → failure registry
