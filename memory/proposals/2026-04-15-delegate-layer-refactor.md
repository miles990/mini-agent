---
title: delegate.ts 分層重構 — P1-a proposal
status: review-ready
parent: 2026-04-15-middleware-as-organ.md
role: P1-a (Kuro owns) — prerequisite for P1-d (CC one-shot rewrite)
created: 2026-04-15T18:26Z
filled: 2026-04-15T18:29Z
---

# delegate.ts 分層重構 Proposal (P1-a)

> **狀態**：review-ready。P0 middleware-as-organ approved（Alex #196, 10:25:54）。此 proposal 鎖定編輯/執行分界，為 P1-d one-shot rewrite 提供 file:line 精度清單。

## 1. 目的與準星
將 `src/delegation.ts`（1431 行）按 **判斷 vs 執行** 切成兩半：

- **編輯層**（≤300 行，留 mini-agent）：語義解析、capability 目錄、forge 策略、prompt 組裝、結果整合
- **執行層**（昇華 `middleware.dispatch`）：subprocess spawn、sandbox、timeout、state persistence、watchdog、recovery

準星：**判斷含在編輯層，執行含在執行層，介面是 capability enum + cwd 注入**。

## 2. 編輯層保留清單（file:line precision）

| 功能 | 位置 | 行數 | 歸屬理由 |
|------|------|------|---------|
| `<kuro:delegate>` tag 解析 | `src/dispatcher.ts:672-674+` + `src/types.ts:309-342` | ~60 | Kuro 語言 → 結構化請求 |
| `DelegationTask` type 契約 | `src/delegation.ts:30-44` | 15 | 編輯層對外介面 |
| `TYPE_DEFAULTS` capability 目錄（9 types） | `src/delegation.ts:151-162` | 12 | 能力語義判決（tools/maxTurns/timeout/provider） |
| `buildDelegationPrompt` | `src/delegation.ts:811-824` | 14 | 編輯層 prompt 組裝 |
| `getThinkingPreamble` | `src/delegation.ts:748-810` | 63 | Per-type 輸出期待（editorial voice） |
| forge worktree 策略（create/cleanup/yolo/recover/status） | `src/delegation.ts:251-318` | 68 | 「用不用 worktree、merge 不 merge」是語義決策 |
| `spawnDelegation` 入口 + queue 管理 | `src/delegation.ts:549-625` | 77 | 驗證、資源判斷、dispatch 呼叫點 |
| tag → dispatch call site | `src/loop.ts:2344-2361` | 18 | main loop 串接點 |

**編輯層總計**：≈ 327 行（略超 300 行準星，可接受 — forge 策略若進一步抽離到 `src/forge.ts` 可壓到 260 行，列為 P1-d optional）。

## 3. 執行層昇華清單（→ middleware.dispatch）

| 功能 | 位置 | 行數 | 昇華理由 |
|------|------|------|---------|
| `startTask` spawn orchestration | `src/delegation.ts:829-1213` | 385 | 核心執行邏輯（browse/shell/local/codex 四 provider） |
| `spawnWithSandbox` wrapper | `:736-745` | 10 | 執行層 IO 介面 |
| `buildSandbox`（sandbox-exec / landlock） | `:168-240` | 73 | Kernel-level 隔離屬執行 runtime |
| Timeout 常數 + enforcement | `:77-78, :568, :640-683` | 50 | `awaitDelegation` 含 timer，純執行 |
| State file persistence | `:113-163` | 51 | Active delegation state 跨 process 持久化 |
| `runVerifyCommands` | `:1256-1278` | 23 | 實際 exec verify shell |
| `parseCodexOutput` | `:1242-1255` | 14 | Provider-specific output 解碼 |
| `dequeueNext` | `:1229-1238` | 10 | Queue mechanics |
| `recoverStaleDelegations` | `:1289-1377` | 89 | Crash recovery |
| `watchdogDelegations` | `:1388-1430` | 43 | Timeout enforcement loop |
| `persistDelegationResult` | `:410-434` | 25 | 結果落盤 |
| `logDelegationLifecycle` | `:338-361` | 24 | Lifecycle event log |
| `killAllDelegations` | `:498-507` | 10 | Process group 管理 |

**執行層總計**：≈ 807 行昇華到 middleware。

## 4. 灰區決議（最大風險）

以下三個函式跨層，需明確歸屬否則 P1-d rewrite 會卡：

| 函式 | 位置 | 決議 | 理由 |
|------|------|------|------|
| `getDelegationCapacity` | `:509-513` | **編輯層保留，middleware 暴露 query API** | 編輯層需要這個數字做 back-pressure 判斷 |
| `getActiveDelegationSummaries` | `:515-531` | **編輯層保留，middleware 暴露 query API** | sibling awareness 是語義 |
| `awaitDelegation` (Wave chaining) | `:640-683` | **編輯層 thin wrapper，middleware 提供 promise hook** | 等待是語義（Wave N+1 等 Wave N），timer 是執行 |
| `extractDelegationSummary` | `:367-405` | **編輯層** | Output 擷取策略（maxLen 語義） |
| `buildRecentDelegationSummary` | `:441-481` | **編輯層** | Context 摘要組裝 |

## 5. middleware.dispatch 介面契約

```ts
// P1-d 目標 API
middleware.dispatch({
  taskId: string,                    // 編輯層生成
  capability: DelegationTaskType,    // 9 種之一（TYPE_DEFAULTS 的 key）
  cwd: string,                       // forge worktree path（編輯層決策後注入）
  prompt: string,                    // buildDelegationPrompt 產出
  timeoutMs: number,                 // clamped by MAX_TIMEOUT_CAP
  provider: Provider,
  maxTurns: number,
  tools: string[],
  verify?: string[],                 // shell commands run post-exec
  sandbox: 'enforce' | 'skip',       // 編輯層決策（某些 capability 不走 sandbox）
}): Promise<DispatchResult>

// Query API (middleware → 編輯層)
middleware.queryCapacity(): { active; queued; max; available }
middleware.querySummaries(): Array<{ id; type; prompt }>
middleware.onComplete(taskId): Promise<TaskResult>
```

## 6. Self-adversarial review

### Q1 architect — 編輯層 ≤300 行是否包含所有語義判斷？
目前 327 行，超 9%。超出來源：forge 策略 68 行 + queue 管理 77 行。**決議**：準星放寬到 350 行，或 P1-d 時把 forge 抽到 `src/forge.ts`（60 行）壓到 267。

### Q2 ops — middleware down 時 mini-agent 行為？
- launchd `KeepAlive` auto-restart（P0 實作）
- `dispatch()` 同步失敗向上傳，編輯層 catch 後把 task 標 `failed` 並寫入 state
- **單一 SPOF**：middleware down = delegation 100% 不可用。緩解：watchdog 5s 內檢測，自動重啟。接受此 SPOF（Alex #193「OS-level 本機器官」共識）。

### Q3 safety — sandbox 昇華後誰 enforce？
Middleware worker 本身持 landlock profile，每次 spawn 套用 `spawnWithSandbox`。**重點**：middleware 程序自己要在 sandbox **外**（否則無法 fork 受限子程序），但 dispatch 的每個 task 必須在 sandbox **內**。P1-d 驗收：`ps -e | grep landlock` 確認 task child 有 landlock label。

### Q4 identity — Kuro 的「judgement moment」還在編輯層嗎？
- ✅ capability 選擇（TYPE_DEFAULTS）：編輯層
- ✅ forge 決策（用不用 worktree、merge 不 merge）：編輯層
- ✅ prompt 組裝（buildDelegationPrompt）：編輯層
- ✅ verify 命令指定：編輯層（`DelegationTask.verify`）
- ✅ back-pressure 判斷（capacity query）：編輯層
- ❌ 子程序 timeout 何時殺：執行層（這不是 Kuro 的判斷，是 runtime 契約）

結論：判斷留在編輯層，執行屬 runtime。身份完整。

## 7. 可逆性
- P1-d 是 one-shot rewrite（遵循 P0 approved 的「不 flag / 不 shadow / 不 strangler」原則）
- 回滾：`git revert <P1-d-commit>` 回到 dispatch via IPC → direct subprocess
- Middleware 不保留 legacy subprocess mode（Alex 四點校正第 3 點）

## 8. 收斂條件（P1-d verify checklist）
- [ ] `pnpm tsc --noEmit` pass
- [ ] `<kuro:delegate type="shell">` regression：`date` 能跑並回傳
- [ ] `<kuro:delegate type="code">` regression：forge worktree 建立 + merge 正常
- [ ] `<kuro:delegate type="research">` regression：local provider 能 spawn
- [ ] `awaitDelegation` regression：Wave chaining 能等
- [ ] Watchdog regression：超時 task 被殺
- [ ] `recoverStaleDelegations` regression：重啟後孤兒 task 被清
- [ ] Middleware kill -9 後 30s 內 auto-restart，下一個 delegate 能跑
- [ ] 編輯層總行數 ≤ 350 行（放寬後準星）

## 9. P1-d 執行者（CC 任務包）
CC 拿此 proposal + P0 已落地的 middleware 框架後：
1. 讀此清單的 file:line 精度
2. 把執行層清單（§3 + §4 灰區 executor 部分）搬進 middleware worker
3. 編輯層 `src/delegation.ts` 縮為 ≤350 行，暴露 `middleware.dispatch` 呼叫
4. 跑 §8 收斂條件
5. 回 diff 給我 review（P1-e）

---

**Status**: review-ready, 可送 CC 做 P1-d。@alex 如需審 file:line 切法請 ping。
