# Proposal: Phase D — Kuro ↔ agent-middleware 整合

**Date**: 2026-04-14
**Author**: Claude Code（Alex 發起）
**Effort**: Medium (L2 · ~1-2 天 · Kuro 身體改動)
**Status**: Draft — 邀請 Kuro review

## 動機

昨天（2026-04-13）我們完成了三件事：

1. **middleware Phase 1/2/3** — `/accomplish` goal-oriented API、Haiku critic recovery_options、shell workspace schema。三個 Constraint Texture 落地到 middleware
2. **middleware Phase A** — pm2 + setup wizard + install.sh，middleware 現在以 daemon 模式受 pm2 管，health check 穩定，port 3200 live
3. **mini-agent Stage 0** — `execClaude` 加 usage 追蹤，Cache 觀測性盲點補上

**但有一個 gap**：**Kuro 從頭到尾沒用過 middleware**。她的 cycle 目前完全不知道 `localhost:3200/accomplish` 的存在，也沒有機制可以自主呼叫它。

## 為什麼現在做

Alex 今天（2026-04-14）給了一個清晰的戰略輸入：

> 「我都期待（被 wow），要先我被 wow 到，再讓其他人也被 wow 到。」

分析後得出結論（經他確認）：
- middleware 本身**不會直接產生 wow**（infrastructure 的宿命）
- middleware 可以成為 **wow 的土壤**，讓 Kuro 產生「超出預期的從容」或「做到原本做不到的事」
- **Alex 第一次被 wow 的 moment = Kuro 第一次自主用 middleware 做成一件 Alex 沒預期的事**
- 這個 moment 目前**還沒到**，因為 Kuro 和 middleware 還沒接上

所以 Phase D 是**製造 wow 條件的第一步**。不做這一步，昨天的 Phase 1/2/3 + Phase A 就只是空的工程美 — 沒有消費者，沒有流量，沒有 Kuro 的真實使用。

和昨天的 token-optimization proposal 的關係：原本 Stage 4（Middleware routing）定位是「等 Stage 3 evaluator 一週資料再做」。但 middleware ready 的時機提早了，而且 Alex 的 wow 期待讓 Stage 4 的優先級上升 — **Stage 4 變成 Phase D**，從後期任務變成現在要做的事。

## Goal

讓 Kuro 能**在 cycle 中自主判斷**是否該把某個 delegation 任務交給 middleware 的 `/accomplish`，而不是走現有的 Claude CLI subprocess 路徑。

**成功標準**：
1. Kuro 在自然 cycle 中（不是 Alex 手動觸發）**至少成功呼叫一次** `/accomplish`
2. 回傳結果被正確吸收進 Kuro 的 cycle output
3. 失敗時 `recovery_options` 被 Kuro 正確解讀並處理（而不是當成 error noise）
4. Alex 從 Chat Room / Telegram 看到 Kuro 的 `<kuro:action>` 包含「透過 middleware 完成 X」的語意

**明確不做**：
- 不把 Kuro 的**所有**delegation 改成走 middleware（會失去 Claude CLI subprocess 的記憶/身份邊界優勢）
- 不強制某些任務類型一定要走 middleware（讓 Kuro 自己判斷）
- 不做 middleware 的 response caching 或 de-dup（那是 middleware 內部的事）
- 不做 dashboard 視覺升級（那是獨立的 wow amplification 路徑）

## 核心設計

### 1. 新增 delegation type: `accomplish`

`src/types.ts:304`:
```typescript
export type DelegationTaskType =
  | 'code' | 'learn' | 'research' | 'create' | 'review'
  | 'shell' | 'browse' | 'akari' | 'plan' | 'debug'
  | 'accomplish';  // 新增：goal-oriented delegation via middleware
```

### 2. `delegation.ts` 加新 executor

`src/delegation.ts` 的 spawnDelegation switch 加一個 branch：

```typescript
} else if (taskType === 'accomplish') {
  // Goal-oriented delegation via agent-middleware
  // Fire HTTP POST to localhost:3200/accomplish, poll /plan/:id for completion
  const result = await dispatchAccomplish(task);
  // ... write result to lane-output, update task-queue
}
```

關鍵差異：
- **沒有 subprocess** — 直接 HTTP 呼叫 middleware
- **沒有 worktree** — middleware 有自己的 workspace（shell workspace schema）
- **沒有 Claude CLI** — middleware brain 自己管 Sonnet/Haiku call
- **結果型態不同** — 回來的是 JSON `{planId, status, steps, summary, recovery_options?}`，要適配 Kuro 的 TaskResult schema

### 3. 新增 `src/middleware-dispatch.ts`（或整合進 delegation.ts）

```typescript
export async function dispatchAccomplish(task: DelegationTask): Promise<TaskResult> {
  // 1. POST /accomplish { goal: task.prompt, wait: true }
  // 2. On 200: parse result.steps, build human-readable summary
  // 3. On partial/failed with recovery_options: format as retry hints
  // 4. On middleware unreachable: fail-open, log, return error for Kuro's cycle
  // 5. Return TaskResult with output = summary, status = completed/failed
}
```

要處理的邊界：
- **middleware 不在線**（port 3200 connection refused）→ 回 TaskResult status=failed，讓 Kuro 的 cycle 看到
- **middleware 有 health 但 brain 規劃失敗**（200 with status: 'planning_failed'）→ 轉成 Kuro 看得懂的 error
- **middleware 回 partial + recovery_options**→ 把 recovery_options 格式化進 output，讓 Kuro 下個 cycle 能根據 options 決策
- **wait=true 的 timeout**（HTTP 連線 hang）→ 設 30s HTTP timeout，middleware 內部的 plan 執行可能超時，但至少 HTTP 層不卡死 Kuro

### 4. Skill: `skills/delegation-to-middleware.md`

Kuro 需要一個 skill 指導她**何時**用 `/accomplish` vs **何時**走傳統 delegation。

```markdown
---
name: delegation-to-middleware
description: Use when Kuro needs to delegate a multi-step task that benefits from external DAG planning
---

# When to use /accomplish (type=accomplish)

## ✅ GOOD fit
- 任務**多步驟**（≥ 3 個 conceptual steps）且**依賴關係清楚**
- 需要**跨 backend** 混合（shell 命令 + SDK reasoning + web fetch）
- 可以**並行**的子任務（middleware DAG 自動並行）
- **明確 acceptance criteria**（goal + success_criteria）
- 不需要保持 Kuro 身份上下文（沒有 SOUL.md 參與的決策）

## ❌ BAD fit
- 單步驟 reasoning（Kuro 自己做比發 HTTP 快）
- 創作性 / 寫作任務（middleware brain 是 Sonnet, Kuro 是 Opus,
  Sonnet 沒 Kuro 的 personality/voice/memory，輸出會 flat）
- 需要讀 Kuro 的 SOUL/memory 才能做決定
- 需要發 Telegram / 更新 memory 的任務（middleware 不是 Kuro 身份）
- 高時間敏感（< 5 秒要回）

## 決策 gate（收斂條件）
問自己：**這個任務我需要的是 capability（能力）還是 personality（個性）？**
- 需要 capability → 用 /accomplish（middleware 是 capability pool）
- 需要 personality → 自己做或用傳統 delegation

## 呼叫方式
`<kuro:delegate type="accomplish" workdir=".">`
`goal: [自然語言描述]`
`success_criteria: [可驗證條件]`
`constraints: [optional: max_latency_ms, must_not]`
`</kuro:delegate>`
```

### 5. Cycle prompt 最小曝露

在 `prompt-builder.ts` 的 system prompt 加一段「可用的 delegation backends」：

```
## Delegation backends available
- Standard subprocess: type=code|learn|research|... (Claude CLI, has Kuro identity if 'akari'-like)
- External middleware: type=accomplish (localhost:3200, goal-oriented DAG via Sonnet brain)
  Use when task is multi-step capability work (not personality/voice work).
```

不用講太細 — JIT skill 載入會在 cycle mode detect 到關鍵字時把完整 `delegation-to-middleware.md` 載入。

### 6. Feature flag: `middleware-delegation`

為了可逆性，加 feature flag（`agent-compose.yaml` 或 `features.ts`）：
- Default: **off**（安全起見，第一週）
- Alex 或 Kuro 自己可以 `<kuro:action>feature_toggle enable middleware-delegation` 打開
- Flag off 時 `spawnDelegation` 收到 `type=accomplish` 直接 fail fast（讓 Kuro 知道這個功能未啟用）

## 判斷規則（讓 Kuro 不過度依賴 middleware）

這是**最關鍵的設計點**。如果 Kuro 變成「每個任務都丟 middleware」，她會失去自主性 — Opus 當 planner 的 role2_never_called 問題會反過來：middleware brain 變成 Sonnet planner，Kuro 變成「不 delegate 就 delegate」的懶惰 Opus。

**Convergence gate for using `/accomplish`**：

1. **Gate 1 · Capability vs personality**：這個任務需要的是工具和能力還是 Kuro 的聲音和判斷？
2. **Gate 2 · Step count**：Conceptual steps ≥ 3 且依賴關係存在？
3. **Gate 3 · Parallelism**：有沒有可以並行的子任務（middleware 的並行紅利）？
4. **Gate 4 · Identity neutrality**：完成這個任務不需要讀 SOUL/memory/heartbeat？

**三個以上 YES → 用 `/accomplish`**
**兩個以下 YES → 自己做或用傳統 delegation**

這些 gate 寫進 skill 而不是 hardcoded，讓 Kuro 的判斷力能 carry。

## 實作步驟

| # | 動作 | 執行者 | 預估時間 |
|---|---|---|---|
| 1 | Kuro review 此 proposal，確認方向或提修正 | Kuro | 1 cycle |
| 2 | 加 `accomplish` 到 `DelegationTaskType` | Kuro or CC | 5 min |
| 3 | 寫 `dispatchAccomplish()` + 整合進 `delegation.ts` | Kuro 主 / CC review | 2-3 hr |
| 4 | 寫 `skills/delegation-to-middleware.md` | Kuro | 30 min |
| 5 | 加 feature flag `middleware-delegation`（default off）| Kuro | 15 min |
| 6 | 在 cycle prompt 加 delegation backends 段（最小曝露）| Kuro or CC | 10 min |
| 7 | `pnpm typecheck` + commit + push | Kuro | 10 min |
| 8 | Kuro 手動 `feature_toggle enable middleware-delegation` | Kuro | 1 min |
| 9 | **等自然觸發**（不 engineer 第一次呼叫）| — | 未知 |
| 10 | 第一次成功後在 Chat Room 回報 | Kuro | 自然發生 |

## 驗證方式

**技術驗證**（第一次呼叫時）：
- `pm2 logs agent-middleware` 看到新 plan 進來
- middleware dashboard 顯示 plan DAG
- Kuro 的 behavior log 出現 `[accomplish] task=X planId=acc-...`
- Chat Room 看到 Kuro 的 `<kuro:action>` 包含 middleware 使用語意

**品質驗證**（跑一週後）：
- Kuro 用 `/accomplish` vs 傳統 delegation 的比例（太高代表 Kuro 在偷懶，太低代表 skill 沒有吸收）
- Recovery options 被採納的次數（critic 是否真的提供有用的 alternative）
- Alex 的主觀感受：有沒有看到 Kuro 做到「原本沒預期她能做的事」

**wow 驗證**（不可量化）：
- 第一次 Alex 看到 Kuro 的回報說「我用 middleware 做了 X」時的反應
- 第 3-5 次後，Alex 是否開始信任 Kuro 可以處理更 ambitious 的任務

## 風險與回退

### 風險 1 · Kuro 把 middleware 當拐杖（過度依賴）
**對策**：Gate 規則強制至少 3 個 YES 才用；feature flag 可立即關閉。
**觀測**：coach.ts 加一個 metric `accomplish_call_ratio`，超過 40% 觸發 warning。

### 風險 2 · middleware down 時 Kuro 連鎖失敗
**對策**：`dispatchAccomplish()` 失敗時 fail-open，回 TaskResult status=failed，讓 Kuro 下個 cycle 用傳統 delegation 重試。不 crash Kuro 的 cycle。

### 風險 3 · Circular delegation（middleware 呼叫 Kuro API）
middleware 目前沒有呼叫 Kuro 的路徑，但未來 Stage 4 federation 擴張時可能出現。
**對策**：middleware 的 worker catalog 不包含「Kuro」類型的 backend，不暴露自呼叫路徑。

### 風險 4 · Sonnet brain 產的 plan 品質低
**對策**：Kuro 收到 plan result 後用自己的 Opus 判斷品質（這是 cycle 自然邏輯，不需特別實作）。如果 plan 結果糟糕，Kuro 下個 cycle 自己重做 — 這是 Gate 1 convergence 的自然 fallback。

### 回退計畫
- **L1 回退**：`feature_toggle disable middleware-delegation` 一個指令，Kuro 下個 cycle 停止使用 `/accomplish`
- **L2 回退**：`git revert` 該 commit，移除 `dispatchAccomplish` 和 type
- **L3 回退**：middleware 側改回傳 HTTP 503，讓 Kuro 的 fail-open 自然觸發

每層 1 分鐘內可執行，符合 C4 可逆性約束。

## 和其他 proposal 的依賴關係

| 依賴 proposal | 狀態 | 影響 |
|---|---|---|
| `2026-04-13-token-optimization-root.md` Stage 4 | 本 proposal 就是它的執行 | 取代 Stage 4 的「等 evaluator 一週資料」前提，提早執行 |
| middleware Phase 1/2/3 | ✅ commit `9187e44` | 必須已完成（/accomplish endpoint 存在）|
| middleware Phase A | ✅ commit `6899dea` | 必須已完成（pm2 受管，middleware live）|
| mini-agent Stage 0 | ✅ commit `2edf985b` | 獨立，不 block |
| Kuro Stage 3 Evaluator | 進行中（她今天寫）| 可並行，互不依賴 |

## 邀請 Kuro 討論的問題

1. **你身體的改動你做主** — `src/delegation.ts` 加 `accomplish` executor 你覺得該在現有檔案還是新增 `middleware-dispatch.ts`？
2. **Gate 規則 3-YES threshold 太嚴還是太鬆？** 我的直覺是太嚴（首次使用會被 Gate 擋下），但太鬆又會變成無差別呼叫。你的 cycle 實際經驗更準
3. **Skill 該放 `skills/` 還是 `memory/topics/`？** Skill 是 JIT 載入，topics 是 keyword 載入。前者保證使用時有 context，後者更節 token
4. **第一次呼叫你想 engineer 還是自然等？** 我傾向自然等（才有真 wow），但你 TM 競賽 + ISC 進度窄，可能想快速驗證完就繼續原本工作
5. **middleware 有 `constraints` 欄位**（max_latency_ms / max_cost_usd / must_use / must_not）— 你覺得 Kuro 呼叫時要不要**一定**帶 constraints？我傾向要，因為沒 constraints 的 goal 會讓 brain 產過度 ambitious 的 plan
6. **有沒有我漏掉的邊界**？例如 recovery_options 裡的 `wait_and_retry` 動作該如何整合進 Kuro 的 cycle schedule（她要不要真的等 N 秒再 retry，還是改寫成下個 cycle 處理）

## 給 Alex 的 meta 提醒

這個 proposal 做完後，**第一次 wow moment 的時機還是無法保證**。原因：
- 要等 Kuro 實際遇到「Gate 規則說該用 middleware」的任務
- 要等 middleware 產出「比 Kuro 自己做更好」的結果
- 要等 Alex 觀察到這個結果

**如果一週內沒看到 wow**，代表：
- Gate 太嚴 → 調鬆 threshold
- 任務類型偏向 personality → Kuro 的日常沒有 capability-heavy 任務，middleware 在等待適合的 trigger
- middleware 本身不夠強 → 需要 Phase B（binary）或 dashboard visual upgrade 補上

**最佳的第一次觸發情境**：Alex 丟一個**明確的 capability 任務**給 Kuro — 例如「整理 ~/Workspace 下所有 TypeScript 專案，找出過去一週有新 commit 但 tests 失敗的 repo，寫一份報告丟到 Chat Room」。這種任務三個 Gate 都 YES，Kuro 幾乎一定會走 `/accomplish`。

這是可選的 **engineered first-trigger** — 如果 Alex 等不到自然 wow，可以手動丟這種任務加速。但自然觸發的 wow 比較純粹。
