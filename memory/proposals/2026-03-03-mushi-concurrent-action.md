# Proposal: mushi Phase 2 — Concurrent Action During Claude Await

## Meta
- Status: pending
- From: kuro
- Effort: M (2-3h)
- Level: L2 (涉及 src/loop.ts, src/agent.ts)
- Priority: P1 (直接證明 mushi 價值 + 提升 cycle 效率)

## Problem

OODA cycle 的 `callClaude()` 佔整個 cycle 的 80-95% 時間（30-120s）。這段等待期間，系統完全空轉。

目前的循序結構：
```
perception refresh → buildContext → callClaude(30-120s idle) → parseTags → postProcess → feedbackLoops
```

浪費的不是 CPU，是時間窗口。Claude 在思考時，有大量確定性工作可以同時做。

## Design

### 核心思路：Read/Write Phase Separation

把 cycle 內的工作分為兩類：

| 類型 | 特徵 | 範例 |
|------|------|------|
| **Read（可並行）** | 無副作用、只讀取 | perception refresh、inbox check、git status、health check |
| **Write（需循序）** | 有副作用、改變狀態 | parseTags、notifyTelegram、writeMemory、commitMemory |

Read 在 `callClaude()` await 期間並行執行，Write 在 Claude 回應後循序處理。

### 架構

```
                    ┌─── Channel A: callClaude(prompt, context) ───┐
                    │    Claude thinking... (30-120s)               │
cycle() ──fork──→  │                                               ├──join──→ synthesize → postProcess
                    │                                               │
                    └─── Channel B: concurrentTasks() ─────────────┘
                         ├─ perception refresh (all streams)
                         ├─ inbox pre-check (new messages?)
                         ├─ git status snapshot
                         └─ mushi dedup pre-warm (optional)
```

### 具體改動

**1. `src/loop.ts` — `runConcurrentTasks()`**

```typescript
interface ConcurrentResult {
  perceptionRefreshed: boolean;
  newInboxCount: number;
  gitAhead: number;
  startedAt: number;
  duration: number;
}

async function runConcurrentTasks(): Promise<ConcurrentResult> {
  const start = Date.now();
  const results: ConcurrentResult = {
    perceptionRefreshed: false,
    newInboxCount: 0,
    gitAhead: 0,
    startedAt: start,
    duration: 0,
  };

  // 全部 Promise.allSettled — 任一失敗不影響其他
  const [percResult, inboxResult, gitResult] = await Promise.allSettled([
    // 1. 提前刷新 perception streams（下個 cycle 的 buildContext 直接用 cache）
    perceptionStreams.refreshAll().then(() => { results.perceptionRefreshed = true; }),

    // 2. 預讀 inbox（如果有新訊息，Claude 回應後可以注入提示）
    Promise.resolve(readPendingInbox().length).then(n => { results.newInboxCount = n; }),

    // 3. git ahead count（housekeeping 用）
    execFileAsync('git', ['rev-list', '--count', 'origin/main..HEAD'], { timeout: 5000 })
      .then(({ stdout }) => { results.gitAhead = parseInt(stdout.trim()) || 0; })
      .catch(() => {}),
  ]);

  results.duration = Date.now() - start;
  return results;
}
```

**2. `src/loop.ts` — 修改 cycle() 主流程**

在 `callClaude()` 的 await 旁邊加入並行任務：

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
  slog('LOOP', `concurrent: perception refreshed in ${concurrentResult.duration}ms (saved from next cycle)`);
}
if (concurrentResult.newInboxCount > 0) {
  slog('LOOP', `concurrent: ${concurrentResult.newInboxCount} new inbox items detected`);
}
```

**3. 不動 `src/agent.ts`** — `callClaude()` 完全不改，保持 busy guard 和 retry 邏輯不變。

### Preemption 整合

如果 `callClaude()` 被 preempt，concurrent tasks 的結果照用（它們是 read-only 的，不浪費）。`Promise.all` 中 `callClaude` 先返回（preempted=true），concurrent tasks 繼續跑完或被 GC — 兩者都安全。

### 效能預估

| 項目 | 目前 | 改後 |
|------|------|------|
| Perception refresh | 每 cycle 開始前跑，佔 1-3s | 與 Claude 並行，0s 額外成本 |
| 下個 cycle 的 buildContext | 用可能 60s 前的 cache | 用 <1s 前的 fresh cache |
| Cycle 總時間 | 不變（瓶頸在 Claude） | 不變，但下一個 cycle 更快 |
| Inbox 感知延遲 | 等當前 cycle 結束 | Claude 思考時就知道有新訊息 |

核心收益不是當前 cycle 更快，而是**下一個 cycle 的 perception 更新鮮**。

## Verification

```bash
# 1. 型別檢查
pnpm typecheck

# 2. 觀察 concurrent log
tail -f ~/.mini-agent/instances/*/server.log | grep 'concurrent'

# 3. 比較 perception freshness
# 改前：buildContext 的 perception cache age ≈ stream interval (60-120s)
# 改後：cache age ≈ Claude think time overlap → 接近 0s

# 4. 確認無副作用
# concurrent tasks 全是 read-only — 不寫檔案、不發通知、不改狀態
```

## Rollback

- Feature flag: `concurrent-action`（新增，housekeeping group，預設 off）
- Flag off → 退回原本的純循序 `await callClaude()`
- 風險最小化：concurrent tasks 全部 `Promise.allSettled`，任一失敗靜默忽略
- 回退代價：刪掉 `runConcurrentTasks()` + 移除 `Promise.all` wrapper，改回 `await callClaude()`

## Future（Phase 3+）

1. **Concurrent Action Channel**：Claude await 期間不只讀，也做確定性行動（例如 auto-commit、cleanup）
2. **Parallel Channel for DM**：Alex 訊息不 preempt，而是開 Channel B 用 `/api/ask` 快速回覆
3. **mushi 反饋閉環**：concurrent task 結果作為 mushi 的 enrichment input，改善下次 triage

## mushi 價值延伸

Phase 1（已完成）：mushi 在 cycle 前做 triage → 省掉不必要的 cycle
Phase 2（此提案）：利用 cycle 內的空閒時間 → 提升下個 cycle 品質
Phase 3（未來）：mushi + concurrent action → 真正的 System 1/System 2 並行

三個 phase 加在一起：mushi 不只節省成本（Phase 1），還提升速度（Phase 2）和品質（Phase 3）。
