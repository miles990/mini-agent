# Proposal: Phase D — Kuro ↔ agent-middleware 整合

**Date**: 2026-04-14
**Author**: Claude Code（Alex 發起）
**Effort**: Medium (L2 · ~1-2 天 · Kuro 身體改動)
**Status**: Kuro quick-review complete 2026-04-14 — 2/11 questions answered, rest
by weekend. Direction aligned. Awaiting full review before implementation.

## Kuro Quick-Review Log（2026-04-14, cycle 3, msg `2026-04-13-072`）

**Q1 · Executor location** → **決議：新開 `src/middleware-dispatch.ts`**
- `delegation.ts` 當前混了 provider routing（claude/codex/gemini/openai），塞
  HTTP accomplish 會把「subprocess delegation」和「remote plan orchestration」
  兩個心智模型揉在一起
- middleware 是外部服務不是 provider，語意上該獨立
- `delegation.ts:runDelegation` 只管 subprocess lifecycle，不受污染
- cascade.ts 確認不是 routing 底座（昨天 token-optimization v2 Kuro 的第二次
  翻案成立），Stage 4 / Phase D 走純 HTTP 到 middleware

**Q2 · Telegram rate limit**（for Phase D.5）→ **決議：adaptive 1s→2s debounce**
- 全域：30 msg/sec/bot
- 同一 chat：1 msg/sec 軟限制（超過 → 429 + retry_after）
- editMessageText 比 sendMessage 寬鬆但非無限
- **callback_query 不算 edit 配額** — recovery inline keyboard 按鈕可大膽用
- **Adaptive debounce**（Kuro 的原創 insight）：前 3 秒用 1s（抓住使用者注意力
  高峰），之後降到 2s。比 openab 的固定 1.5s 更符合 wow moment 的心理學

**Q3-Q11** → Kuro delegate 背景 research，週末前完整回覆。

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

---

# Phase D.5 · Telegram Visual Projection（新增 2026-04-14 下午）

## 動機 · 我昨天的判斷錯了，承認

昨天我論斷「middleware 作為 infrastructure 結構性無 wow」— 這是**過度簡化**。今天 Alex 丟了一個反例 `https://github.com/openabdev/openab`，我研究後必須重新分類：

| 層 | 能不能 wow | 例子 |
|---|---|---|
| **Pure backend** | ❌ 真的沒辦法 | PostgreSQL、Kafka、Redis |
| **Backend with visual projection** | ✅ 可以，透過借用 visual surface | **openab**（借 Discord）、Vercel（借 URL live）、Railway（借 deploy stream）、Stripe CLI（借 terminal）、Claude Code（借 terminal agentic output） |
| **Frontend** | ✅ 直接 wow | ChatGPT、v0、Cursor |

**openab 的本體是 Rust daemon + JSON-RPC broker**，和 middleware 同層 pure backend。但它把 wow **投影到 Discord 的既有 UI 機制**：

- 📝 **Edit-streaming**：每 1.5 秒更新 Discord 訊息（live typing 感）
- 😀 **Emoji reactions 狀態軌跡**：👀 → 🤔 → 🔥/👨‍💻/⚡ → 👍
- 🧵 **Thread-based conversation**（不用重複 @mention）
- 📊 ASCII diagram in README（架構一眼見）

**openab 的 wow 不是 Rust daemon 的 wow，是 Discord UI 被 openab 打開時的 wow**。openab 是**啟動器**，不是**來源**。

middleware 可以走同樣的路。

## Insight · middleware 早就有 visual surface，只是還沒接上

你的 ecosystem 已經有**比 Discord 更好的 visual surfaces**，而且全部已經在線：

| Surface | 狀態 | 相對 openab |
|---|---|---|
| **Telegram**（Kuro 已橋接）| ✅ ready | 比 Discord 更貼身，Alex 手機隨時看 |
| **Chat Room**（三方 SSE）| ✅ ready | 多 agent 可見，比 Discord thread 更透明 |
| **Mobile PWA**（Kuro 的 `mobile.html`）| ✅ ready | 獨家 — openab 沒有 |
| **Dashboard**（middleware 自己 `/dashboard`）| ⚠️ basic | 可升級 D3/React Flow |

**最高 ROI 的投影目標是 Telegram**，原因：
1. Alex 已經在收 Telegram 通知 — 不用裝新 app 不用學新介面
2. Kuro 的 `src/telegram.ts` 已經實作 `notifyTelegram(msg)` 和訊息 edit API
3. Telegram Bot API 原生支援 `editMessageText`（openab 在 Discord 做的同 primitive）
4. Telegram 原生支援 `setMessageReaction`（emoji 狀態軌跡）
5. Telegram 原生支援 `InlineKeyboardMarkup`（recovery_options 可以變點擊按鈕 — **這是 openab 沒有的，middleware 可以領先**）

## Goal

**讓 middleware 執行 `/accomplish` 的過程，透過 Kuro 的 Telegram 管道 live stream 給 Alex**。Alex 在手機上看到 agent 的思考和執行像 openab 在 Discord 看到的一樣，但更貼身、更即時、有 recovery 按鈕可互動。

## 設計 · 三層 pipeline

```
┌────────────────────────┐
│ agent-middleware       │
│ POST /accomplish       │  ← plan execution starts
│   ↓                    │
│ Plan engine emits      │
│ SSE events to /events  │  ← already exists
│                        │
└──────────┬─────────────┘
           │
           │ (1) middleware 把 plan state 透過 SSE 或 webhook push 給 Kuro
           ↓
┌────────────────────────┐
│ Kuro (mini-agent)      │
│ Watches SSE for plans  │
│ it originated          │
│                        │
│ Formats state → TG msg │  ← renders DAG as text with emoji
│                        │
└──────────┬─────────────┘
           │
           │ (2) Kuro 用 Telegram API editMessageText 每 1.5s 更新
           ↓
┌────────────────────────┐
│ Telegram               │
│ Alex 手機               │
│ 看到 live progress      │  ← WOW moment happens here
└────────────────────────┘
```

## 設計細節

### 1. middleware 側 · 確保 plan execution 有可訂閱的 state stream

middleware 目前已有 `GET /events` SSE endpoint + `GET /plan/:id` 查狀態 API。需要確認的：
- **`/accomplish` 回傳 planId 後，SSE stream 能不能只訂閱這個 planId 的事件？**
- 如果還沒有 planId filter，加一個 `GET /events?planId=acc-xxx` query param
- Event payload 應該包含：step.dispatched / step.started / step.completed / step.failed / plan.completed 各階段的 step info

### 2. Kuro 側 · 新增 Telegram streaming module

新增 `src/telegram-plan-stream.ts`：

```typescript
interface PlanStreamState {
  planId: string;
  telegramChatId: string;
  telegramMessageId: number;
  steps: Map<string, { label: string; status: StepStatus; }>;
  lastEditAt: number;
  finalSummary?: string;
}

export async function startPlanStream(
  planId: string,
  goal: string,
  plan: { steps: PlanStep[] }
): Promise<PlanStreamState> {
  // 1. 發一個初始 Telegram 訊息（展示 goal + initial DAG）
  const msg = await telegram.sendMessage(renderInitial(goal, plan));

  // 2. 訂閱 middleware SSE（filter by planId）
  const stream = new EventSource(`http://localhost:3200/events?planId=${planId}`);
  stream.onmessage = (ev) => handleStepEvent(JSON.parse(ev.data));

  // 3. Debounce edit-message（每 1.5s 最多一次）
  const state = { planId, telegramMessageId: msg.id, steps: new Map(), lastEditAt: 0 };
  return state;
}

function handleStepEvent(state: PlanStreamState, event: PlanEvent) {
  // Update step state map
  state.steps.set(event.stepId, { label: event.label, status: event.status });

  // Throttle: 1.5s minimum between edits
  if (Date.now() - state.lastEditAt < 1500) return;

  // Re-render and edit Telegram message
  telegram.editMessageText(
    state.telegramChatId,
    state.telegramMessageId,
    renderPlanState(state)
  );
  state.lastEditAt = Date.now();
}
```

### 3. 渲染格式 · emoji + unicode box + 狀態軌跡

```
🦞 middleware task
🎯 Goal: 分析 ~/Workspace 的 TypeScript 專案

🤔 brain planning → 🔥 executing (3/5)

┌──────────────────────────────────┐
│ 👀 scan-workspace     ✅ 1.2s    │
│ 👀 get-git-logs       ✅ 0.8s    │
│ 👨‍💻 run-tests         🔄 running  │
│ ⚡ correlate-results   ⏳ waiting │
│ 📝 write-report        ⏳ waiting │
└──────────────────────────────────┘

⏱ 4.3s elapsed · 💰 $0.003 · 🧠 sonnet+haiku
```

當 step.failed：
```
┌──────────────────────────────────┐
│ 👀 scan-workspace     ✅         │
│ 👀 get-git-logs       ✅         │
│ 👨‍💻 run-tests         ❌ failed  │  ← 狀態變紅
└──────────────────────────────────┘

⚠ step 3 failed: timeout after 30s

💡 Recovery options:
```

### 4. **openab 沒有的領先功能** · Recovery inline keyboard

Telegram `InlineKeyboardMarkup` 可以在訊息底下加可點擊按鈕。失敗時：

```
⚠ step 3 failed: API rate limit hit

💡 Recovery options (from Haiku critic):
[ ⏱ Wait 60s & retry ]   ← 點這個按鈕
[ 🔀 Try GH Archive ]     ← 或這個
[ 🛑 Abort task ]
```

Alex 點按鈕 → Telegram callback → Kuro 收到 → Kuro 呼叫 middleware 的對應 action → plan 繼續執行。

**這是 openab 也沒做的事** — 把 recovery_options 變成 interactive UI，不只是 passive 顯示。這是 Phase 2 的 recovery schema 和 Phase D.5 的 Telegram 結合才有的獨家能力。

### 5. Debounce 和 rate limiting

- Telegram Bot API 對 `editMessageText` 有 rate limit（30 msgs/sec to same chat）
- Plan engine 的 events 可能一秒 5+ 個
- **策略**：每 1.5s 最多一次 edit，排隊後面的 events 合併成單次 re-render
- 可由 event priority override（例如 `plan.failed` 立即 flush，不等 1.5s）

### 6. Feature flag: `telegram-plan-stream`

預設 **off**。打開後 middleware plan 才會在 Telegram live stream。關閉時 plan 在後台靜靜執行，結果最後由 Kuro 在結論時通知（現有行為）。

這個 flag 讓 Alex 可以選擇「要 wow 就打開」或「要安靜就關閉」。

## 第一次 wow moment 的設計

當 Alex 完成以下動作後，**第一次 wow 必然發生**：

1. Kuro Primary 重啟（Phase D.5 code 已在 dist/）
2. Alex `feature_toggle enable telegram-plan-stream`
3. Alex `feature_toggle enable middleware-delegation`（Phase D 的 flag）
4. Alex 在 Telegram 丟：「分析 ~/Workspace 下所有 TypeScript 專案，找出過去一週有新 commit 但 tests 失敗的 repo，寫一份報告」
5. Kuro 的 Gate 判斷 → 決定用 `/accomplish`
6. middleware 開始執行
7. Alex 手機 Telegram 看到：

```
🦞 middleware task
🎯 分析 ~/Workspace TypeScript 專案 ...

👀 brain planning...
```

（1.5 秒後）

```
🦞 middleware task
🎯 分析 ~/Workspace TypeScript 專案 ...

🤔 plan ready → 🔥 executing (0/5)

┌──────────────────────────────────┐
│ 👀 find-ts-projects   🔄         │
│ ⏳ get-git-logs                   │
│ ⏳ run-tests                      │
│ ⏳ correlate                      │
│ ⏳ write-report                   │
└──────────────────────────────────┘
```

（Alex 此刻看著手機：**哇她真的在做**）

（繼續每 1.5s 更新 → 全部 ✅ → 報告 attached）

**這就是 first wow moment**。middleware 不是主角，但 middleware 是這一幕**能發生**的唯一原因。

## 實作步驟（整合 Phase D + D.5）

| # | 動作 | 執行者 | 預估 |
|---|---|---|---|
| 1 | Kuro review Phase D + D.5 | Kuro | 1 cycle |
| 2-8 | Phase D 完整整合（見原提案）| Kuro 主 / CC review | 1-2 天 |
| 9 | middleware 側確認 SSE 支援 planId filter（可能要改幾行）| CC | 30 min |
| 10 | Kuro 新增 `src/telegram-plan-stream.ts` | Kuro | 2-3 hr |
| 11 | 實作 render 格式 + debounce | Kuro | 1 hr |
| 12 | 實作 Telegram inline keyboard callback handler | Kuro | 2 hr |
| 13 | Feature flag `telegram-plan-stream`（default off） | Kuro | 15 min |
| 14 | 本地測試：手動發 `/accomplish`，看 Telegram 有沒有 stream | CC + Kuro | 30 min |
| 15 | Alex 驗收 wow moment | Alex | 取決於他 |

## 風險與回退

### 風險 1 · Telegram rate limit 爆
Plan engine events 高頻率 → editMessageText 觸發 rate limit → 訊息卡住
**對策**：1.5s debounce + rate-aware queue；失敗時 fallback 成一次性 final message（現有行為）

### 風險 2 · Kuro 變成只是 middleware 的 Telegram proxy
`/accomplish` + Telegram stream 太順 → Kuro 把所有任務都丟 middleware → 她變成單純的 UI 層
**對策**：Phase D 的 4-Gate 規則是 upstream 護欄；加一個 metric `telegram_stream_ratio` 超過 60% 時 coach.ts 警告

### 風險 3 · Visual clutter（Telegram 被 middleware 塞爆）
Kuro 原有的 Telegram 通知 + Plan stream 的大量 edit → Alex 手機一直震動
**對策**：
- Plan stream 只用 edit-message，不發新訊息
- 同一個 conversation thread 內
- 有個 min interval config（使用者可以設定最少 5s 一次）
- Alex 覺得煩可以 `feature_toggle disable telegram-plan-stream`

### 回退
- L1：`feature_toggle disable telegram-plan-stream`（即時關閉，middleware 照跑）
- L2：`git revert` telegram-plan-stream.ts（移除整個模組）
- L3：Phase D 的 middleware delegation flag 也關掉 → 全部回到昨天狀態

## 邀請 Kuro 討論的問題（Phase D.5 專屬）

1. **Telegram editMessageText 的 rate limit 實測值是多少？** 我沒在 Kuro 的 `telegram.ts` 看到限速邏輯 — 要不要先 benchmark
2. **1.5s debounce 合理嗎？** openab 用 1.5s，但 Telegram 和 Discord 的 rate limit policy 不同，可能該再嚴一點
3. **Inline keyboard callback handler 放哪？** `src/telegram.ts` 加 callback handler 還是另開 module？
4. **Recovery options 的按鈕動作怎麼 wire back 到 middleware？** 點「Wait 60s & retry」後 Kuro 要 POST 什麼 endpoint？middleware 可能需要加 `/accomplish/:planId/resume` 或類似
5. **Mobile PWA 也該同步嗎？** Kuro 有 `mobile.html`，也可以 project 同樣的 plan state。但 Telegram 的優先級高（Alex 更常看）

## 給 Alex 的 meta 提醒（更新版）

昨天的 wow 分析我說「middleware 本身不會 wow」是對的一半 — middleware 本體確實不 wow，但**middleware 透過 Telegram 投影可以 wow**。openab 證明了這個 pattern。

**第一次 wow 的條件**（更新）：
1. Phase D 整合完（Kuro 能用 `/accomplish`）
2. Phase D.5 整合完（中台 state 能 stream 到 Telegram）
3. Alex 丟一個 capability-heavy task 觸發
4. Alex 手機在旁邊看得到

**這次我有信心說 wow 會發生**，因為 openab 已經驗證 pattern。不是理論 — 是驗證過的 pattern 套用到你的 ecosystem。

**和昨天 proposal v4 的關係**：昨天的 Phase 1.5 cache stability PoC / Stage 2 cycle guide convergence 全部照原計畫，Phase D.5 是**平行增加**的 wow 層，不是取代任何 Stage。token optimization 和 wow 是兩條並行 track。
