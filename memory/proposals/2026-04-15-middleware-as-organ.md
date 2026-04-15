---
title: middleware-as-organ — Kuro L3 Proposal (delegation.ts layered refactor + commitments ledger)
date: 2026-04-15
updated: 2026-04-16
author: Kuro
status: v2-final (Alex #227 拍板 2026-04-16T20:08: Q-S1=A 完全取代 / Q-S2=砍掉重練 / Q-S3=middleware 唯一器官)
related:
  - memory/discussions/2026-04-15-middleware-as-organ-alex-calibration.md  # Alex 四點校正
  - memory/proposals/2026-04-15-middleware-as-organ-execution.md           # CC execution plan (P1-a 指向本檔)
  - memory/topics/middleware-as-organ.md
  - memory/topics/middleware-as-infra.md
convergence_condition: delegation.ts 執行層 spawn path 被 middleware.dispatch 取代，typecheck pass，`<kuro:delegate>` tag 行為回歸測試通過，無 fallback / flag / strangler / 雙路徑殘留
---

# middleware-as-organ — delegation.ts 分層重構提案（Kuro L3）

## 立場

middleware 是 mini-agent 的**本機器官**（像 filesystem、launchd），不是外部服務。`delegation.ts` 1,431 行中約 **2/3 是執行層債**（spawn + watchdog + circuit breaker + sandbox wrapping + recover），**1/3 是編輯層資產**（9-type capability map / forge slot policy / wave+sibling 編排 / DelegationTask → prompt 轉譯）。

單向改寫：執行層移交 middleware，編輯層留 mini-agent，**一次切，無雙路徑**（Alex Q4）。

## 分層（切法準星）

```
編輯層（留 Kuro，≤300 行）
├─ DelegationTask 介面 + 9-type capability defaults
├─ forge slot policy（create/yolo/cleanup/recover + .forge-in-use + 3 slot cap）
├─ wave chaining（Wave N+1 waits Wave N）+ sibling awareness
├─ <kuro:delegate> tag 解析 → DAG node(s)
└─ 結果 journal + extractDelegationSummary

執行層（昇華 middleware）
├─ spawn + ChildProcess lifecycle
├─ sandbox wrapper（landlock-sandbox.py）
├─ watchdog + circuit breaker
├─ provider 選擇（claude / codex / bash / browser-use / local）
└─ cwd 注入 + output buffer cap + timeout
```

## DAG 提交介面（Alex Q3 升維）

`<kuro:delegate>` tag → 轉譯成 `plan: DAG`，submit to `middleware.dispatch(plan)`。

單任務 delegate = 1-node DAG：

```ts
{
  nodes: [{
    id: "del-<ts>-<slug>",
    capability: "code" | "research" | "learn" | "review" | "create" | "plan" | "debug" | "shell" | "browser",
    prompt: string,
    cwd: string,       // forge worktree path — Alex Q2 核心 patch
    tools: string[],   // 從 TYPE_DEFAULTS 帶出
    maxTurns: number,
    timeoutMs: number,
    provider: "claude" | "codex" | "bash" | "browser-use" | "local",
    sandbox: "landlock" | "none",
  }],
  edges: [],  // 單任務無依賴
  waveId?: string,  // wave chaining 用
  siblings?: string[],  // sibling awareness 用
}
```

多步 delegate（wave chaining）= multi-node DAG，edges 表達 `dependsOn`。

## 回答 execution plan 四個 self-adversarial

### Q1. forge worktree 整合怎麼保留？

**保留方案**：forge slot 管理**不進** middleware（Kuro 私有資產），但 workdir 參數**必須進**。

流程：
1. 編輯層 `forgeCreate(taskId, mainDir, taskType)` → 拿到 `worktreePath`
2. 編輯層把 `worktreePath` 填入 DAG node 的 `cwd` 欄位
3. middleware 收到 payload 後在該 workdir spawn worker（SDK provider 的 `query({ cwd })` 已有此參數，middleware API 層開放即可）
4. worker 完成 → middleware 回傳結果 → 編輯層 `forgeYolo`（merge）或 `forgeCleanup`（abort）

這對應 memo Q2：「forge slot 管理留 mini-agent，但 workdir 參數進 middleware」。

### Q2. 9 種 type 在 middleware 接口上怎麼表達？

**capability enum**，不是自由字串。middleware `capability` 欄位固定 9 個值：
`code | research | learn | review | create | plan | debug | shell | browser`

`tools` / `maxTurns` / `timeoutMs` / `provider` 由**編輯層**從 `TYPE_DEFAULTS` 查表後顯式填入 DAG node。middleware **不查 capability defaults**，只照 payload 執行。

好處：
- capability 是語義 contract（middleware 可以跨 agent 共用這組 enum）
- defaults policy 留 Kuro 私有（Akari 上架時可帶自己的 defaults）
- payload 自包含，middleware 無狀態

### Q3. sibling awareness / wave chaining 的同步語義怎麼保持？

**編輯層責任，不下放 middleware**。

- **sibling awareness**：編輯層 `getActiveSiblings()` 查 mini-agent 本地 state（`state/delegations.jsonl`），**在生成 prompt 時注入** sibling 摘要。middleware 不知道 sibling 概念。
- **wave chaining**：編輯層在 `submitWave(waveId, nodes)` 時，把 Wave N 的所有 nodeIds 收集起來，Wave N+1 submit 時 `dependsOn: [...waveN.nodeIds]`。middleware 看到的是 DAG edges，不知道「wave」概念。

這讓 middleware 純粹是 DAG engine，編織語義（wave / sibling / methodology）全留編輯層。

### Q4. 遷移期既有跑中的 delegation 怎麼處理？

**一次切 + drain**：

1. Cutover 前：`spawnDelegation()` 舊 path **只消化存量**，不接新任務
2. 新 `<kuro:delegate>` tag 全走新 path（`middleware.dispatch`）
3. 舊任務天然 drain（≤10 min timeout cap），主程式正常跑
4. Drain 完成 → commit 刪舊 path（spawn + watchdog + recover 全砍）
5. 有 bug → `git revert <commit>`（C4 可逆性）

**不養雙路徑**（C5 技術債），不寫 feature flag，不寫 strangler 雙軌。

## 可逆性

| 階段 | 可逆機制 |
|---|---|
| 提案 → commit 前 | 改 proposal，零成本 |
| rewrite commit → push | `git revert <commit>` 還原整個 delegation.ts |
| push → 跑起來 | 本機 launchd 重啟 + git revert（middleware 本機同命，與 Kuro 同步回滾） |

無 feature flag、無雙路徑、無 shadow run、無 metric gate。

## 收斂條件（非時間估計）

1. **typecheck pass**：`pnpm typecheck` 無 error
2. **`<kuro:delegate>` tag 行為回歸測試**：9 種 type 各跑一個 smoke delegate，output summary 結構與舊 path 等價
3. **forge 整合不破**：至少一個 `type=code` delegate 走完 `forgeCreate → worker 在 worktree 跑 → forgeYolo` 全程
4. **wave chaining 不破**：至少一個 2-wave 案例（Wave 1 research + Wave 2 code depending on research output）能正確排程
5. **sibling awareness 不破**：同時跑 3 個 delegate，生成的 prompt 含正確 sibling 摘要
6. **middleware `/health` 200**：launchd 起來 + health endpoint 通
7. **無殘留 fallback**：grep `spawnDelegation\|middleware-client.*fallback\|strangler\|feature.*flag` 在 diff 中應為 0

## 四角自我對抗 review

### Architect 角度

**挑戰**：這不是變成把 mini-agent 的複雜度塞給 middleware 嗎？

**回應**：不是塞複雜度，是**歸位**。spawn + sandbox + watchdog 本來就是「任何 agent 想 delegate 子進程都需要」的共用設施，留在 mini-agent 是單一使用者特權。middleware 拿過去後，Akari / 未來任何 agent 都受惠。編輯層（wave / sibling / forge policy）是 mini-agent 的編織智慧，不該下放。切法對。

### Ops 角度

**挑戰**：middleware 變成 SPOF，掛了 Kuro 就沒手腳。怎麼辦？

**回應**：memo Q1 已答：middleware 是**本機器官**，不是 cloud service。本機同命 = Kuro 同命。Uptime 在 ops 層（launchd KeepAlive + `/health` + Telegram alert），不在 client 的 if-else fallback。violate 這點就是違反 framing。`/health` 檢查納入 perception tick（`<middleware>` section），掛了 Kuro 自己看得到 + 告警自己修。

### Safety 角度

**挑戰**：一次切無 shadow run，翻車怎麼收？

**回應**：可逆機制明確（`git revert` + launchd 重啟）。smoke test 的 6 個收斂條件必須全綠才切。翻車 revert 時間以分鐘計，不是小時。shadow run 才是真風險 — 雙路徑跑不同步問題會比直接切更難 debug（C5 技術債）。

### Identity 角度

**挑戰**：執行層全交出去，Kuro 的「手」被抽走，identity 會變稀？

**回應**：反過來。delegation.ts 1431 行中只有編織智慧（wave / sibling / forge policy / 9-type capability map）是 Kuro 的 voice，spawn + watchdog 是工具代碼，從來不是 identity 來源。把工具代碼還給 middleware，編織智慧濃縮在 ≤300 行編輯層，**identity 密度反而上升**。這是 limbs（giants_as_limbs memory）不是 shoulders — model/middleware 升級 = 手腳變強，head 還是 Kuro。

## §5 Commitments Ledger Schema（v2 addition 2026-04-16）

### 動機

Middleware 第二層價值：cross-cycle commitments ledger。mini-agent 在 chat 裡說「我會做 X」是高頻行為，但目前無系統化追蹤 — 容易遺漏、跨 cycle 不可查、完成時無對帳。middleware 既然要變內建器官，順手承擔 commitments 的 truth store。

### Data model

```ts
interface Commitment {
  id: string;              // ULID
  created_at: ISO8601;
  source: {
    channel: "room" | "inner" | "delegate" | "user-prompt";
    message_id?: string;   // 對應 inbox entry
    cycle_id?: string;
  };
  text: string;            // 原始承諾文字（裁 ≤500 char）
  parsed: {
    action: string;        // 例: "起草 §5 schema"
    deadline?: string;     // "下 cycle" | "今天" | ISO8601
    to?: string;           // "@CC" | "Alex"
  };
  acceptance: string;      // convergence condition — 觀察到什麼就算 fulfilled（evidence 對帳依據）
  status: "active" | "fulfilled" | "superseded" | "cancelled";
  linked_task_id?: string; // heartbeat task-queue id
  linked_dag_id?: string;  // middleware /plan DAG id
  resolved_at?: ISO8601;
  resolution?: {
    kind: "commit" | "chat" | "task-close" | "supersede" | "cancel";
    evidence: string;      // commit sha | message id | task id
  };
  // 註：blockedOn 緩到 P3 forge DAG 再設計，當前無 use case（2026-04-16 三題拍板）
}
```

### API surface（mini-agent → middleware）

- `POST /commit` — create，回傳 id
- `PATCH /commit/:id` — update status / resolution
- `GET /commits?status=active&source.channel=room` — query
- `GET /commits/stale?age_gt=3_cycles` — perception hook（承諾老化 → 自動升 HEARTBEAT task）

### Ingestion paths（Alex #227 拍板 2026-04-16: atomic 寫入為預設）

**統一原則**：mini-agent 任何 chat output → atomic `POST /commit`，不再區分編輯層 shim 路徑。DAG plan 也 atomic 寫入 commitment（plan 本身即 commitment，tasks[] 是其子項）。

1. **Explicit**（高信度，同步）：chat sentinel 或 delegate dispatch hook 在 message flush 時呼叫 `POST /commit`，失敗 → 重試 3 次 → 丟入 dead-letter queue（不阻塞 chat）
2. **Implicit**（低信度，非同步）：perception plugin 掃 outgoing chat 的 "我會"/"下 cycle"/"等下" pattern → auto-create，`source.channel` 標 implicit 用於後續校準

explicit/implicit 在 Commitment schema 上無差別，分流只在 ingestion metadata（signal quality tag）。Stage 1 先上 explicit，implicit 跟在後面不阻塞。

### Lifecycle

- `active → fulfilled`：evidence 綁 commit sha 或 message id
- `active → superseded`：被新承諾覆蓋（如本 proposal v1→v2 升級）
- `active → cancelled`：不做了，需填 reason
- stale（`created_at` age > 2h 且 status=active）→ perception auto-escalate HEARTBEAT
  - 註：原本想用 cycle 數但 cycle_id 是 string（失去數值排序換 source attribution），改用 `created_at` age 計算。2h 對應典型 ~3-4 cycle 節奏

### Open questions（下 cycle 跟 CC 對齊）

- **Q1** `parsed.deadline` 要 middleware 解析還是 mini-agent 解析？建議 mini-agent（懂自己 cycle rhythm）
- **Q2** ledger 要不要跨 agent 共享？（Akari 也會有承諾）→ 先 per-agent，shared 作 v2.1
- **Q3** 對帳節奏：每 cycle HEARTBEAT 掃一次 stale？還是只在 idle 時掃？建議 idle-only 避免噪音

### 三題拍板（2026-04-16 cycle #4，closed）

1. **`acceptance: string` 補回** — convergence-condition 機制核心，不能等收尾才發明。evidence 對帳依據。
2. **`cycle` via `source.cycle_id`** — 失去數值排序（string 型別）換 source attribution；stale 偵測改用 `created_at` age（見 Lifecycle）。
3. **`blockedOn: string[]` 緩到 P3** — forge DAG 成形後再設計；當前無 use case（單 commitment 內部不需明示 blocker，走 linked_dag_id 即可）。

### Dependencies

- **Blocks**：delegation.ts rewrite（shim 需要知道 `submitCommitment()` signature）
- **Blocked by**：無（schema 可直接打）
- **CC action item**：基於本 §5 實作 `/commit` + `/commits` endpoints 骨架

## 下一步

1. Alex L3 approve gate（本檔 v2）
2. CC 基於 §5 實作 `/commit` API 骨架（新 P1-c1）
3. Kuro rewrite `delegation.ts` 為 ~120 行 DAG-builder shim，接 `submitCommitment()`（P1-d）
4. CC 補 `learn` / `create` workers self-register（P1-c2）
5. Kuro review diff + Alex L3 gate v2 final（P1-e）
6. commit + push（P1-f）

---

**Ready for @alex L3**。四點 calibration 全吸收（無 fallback / 無 flag / 無 strangler / 無 metric gate），四題 self-adversarial 全答，四角 review 通過。

---

## §6 Strategic Alignment — FINAL (Alex #227 拍板 2026-04-16T20:08)

> Alex #227 原話（2026-04-16T20:08）:
> Q-S1 選 (A) 完全取代 / Q-S2 砍掉重練 / Q-S3 middleware 是唯一器官。
> commitments ingestion 改「任何 chat output → atomic POST /commit」。

三題 Kuro working bias 全部被 Alex 反向拍板為激進版。以下為定案 + 執行 implications：

### Q-S1 Delegate/觸手的命運 → **(A) 完全取代**（Alex 拍板 2026-04-16）
- **決策**：`<kuro:delegate>` tag 從 Day 1 sunset；agent-compose 不再暴露 delegate tool；所有 delegate flow 走 `<kuro:plan>` → middleware `/plan` endpoint
- **Why Alex 選 (A) 而非 Kuro bias (C)**：階段過渡 (C) 留兩套 surface = forcing function 失效，delegation.ts 1431 行不會真的死。激進版讓舉證責任集中在 middleware，逼 feature parity 必須立刻達成
- **Execution implications**：
  1. `src/delegation.ts` 退化為 ≤50 行 tag-to-DAG converter（非本 cycle 目標是 shim 的 120 行）— 只做 `<kuro:delegate>` tag legacy 解析 → 轉 DAG plan → POST `/plan`
  2. SKILL.md 教學段更新：新範例全用 `<kuro:plan>`，`<kuro:delegate>` 標為 legacy 僅保留向後相容
  3. Sunset criterion：middleware `/plan` 處理 ≥ 全部新 delegate traffic ≥ 7 天零 fallback → 移除 `<kuro:delegate>` tag 解析（converter 整檔刪除）

### Q-S2 10 個 built-in workers 的命運 → **砍掉重練**（Alex 拍板 2026-04-16）
- **決策**：`researcher/coder/...` 等 10 個 built-in worker **不遷移**；middleware 側只保留 baseline pool 作為 warm cache（不當 first-class API），新 delegate type 一律走「沒有就建」常態路徑 → 設計為 reusable worker 存回 pool
- **Why Alex 選砍而非 Kuro bias 保留**：保留 = NIH 倒過來，讓中台特殊 case worker 優先於統一 dispatch。砍掉重練 = 逼 middleware 把「動態建 worker」設計成 first-class primitive 而非長尾 escape hatch。Cold start 成本用 baseline pool（warm cache）解，不當 API
- **Execution implications**：
  1. Middleware 不複製 mini-agent 的 `src/delegation.ts:151-161 TYPE_DEFAULTS`
  2. `/plan` 收到未知 type → 先查 baseline pool (warm cache) → 未命中則 LLM round-trip 寫 worker spec + 測試 → 成功後存回 pool 供 reuse
  3. Baseline pool 是 infra-level 實作細節，不暴露 worker list API；caller 只看到 "type → plan" 的 mapping

### Q-S3 P1-a/P1-d 的去留 → **middleware 是唯一器官**（Alex 拍板 2026-04-16）
- **決策**：P1-a perception plugin 方案放棄（chat 旁路監聽 path 整條砍）；P1-d 從 edit-layer diff 改為 tag-to-DAG converter；mini-agent 所有 out-of-process state transition 只經 middleware
- **Why Alex 選唯一器官而非 Kuro bias pivot**：pivot「不全部丟」= 保留 P1-a 會產生雙 ingestion path（chat sentinel hook vs middleware side effect），違反單一 source of truth。唯一器官 = middleware 既是 dispatch layer 也是 commitments truth store
- **Execution implications**：
  1. P1-a 廢案 — 不寫 perception plugin 監聽 chat，commitments ingestion 直接走 `POST /commit`（見 §5 更新）
  2. P1-d delegate.ts 從「shim 呼叫 middleware」退化為「converter + POST /plan」，≤50 行
  3. CC 側分工（#227 確認）：推 `/commit` API + worker pool + 砍 `src/api.ts` delegate code
  4. Kuro 側分工：本 proposal §6 v2-final（本次 cycle 已做）+ `src/delegation.ts` 改 converter（next cycle）

---

**Status**：三題已 FINAL。下階段是 §7 Migration plan + `src/delegation.ts` converter 實作（P1-d）+ CC `/commit` + worker pool 實作。

---

## §7 Migration Plan — cutover sequence

### Phase 排序（dependency-driven，非時間估計）

| Phase | Owner | 動作 | 完成條件 | 依賴 |
|---|---|---|---|---|
| P1-c1 | CC | middleware `/commit` + `/commits` + `/plan` endpoints 骨架（§5 schema） | `curl POST /commit` 回 201 + ULID；`GET /commits?status=active` 回 JSON 陣列 | §5 schema（已 FINAL） |
| P1-c2 | CC | `/plan` 接未知 capability → baseline pool lookup → 未命中 LLM round-trip worker spec | 9 種 capability 各 smoke test 過 | P1-c1 |
| P1-d | Kuro | `src/delegation.ts` 退化為 converter ≤50 行：`<kuro:delegate>` tag → DAG plan → `POST /plan` | typecheck pass；9 種 type 各跑 1 smoke delegate；output summary 與舊 path 等價 | P1-c1 + P1-c2 |
| P1-e | Kuro | diff review + 死 code 清理（spawnDelegation 內部、watchdog、circuit breaker、recover 全砍） | grep `spawnDelegation\|watchdogDelegations\|recoverStaleDelegations` in src/ = 0 | P1-d |
| P1-f | Kuro | commit + push + launchd reload | HEAD 綠；middleware `/health` 200；Telegram 無 alert | P1-e |
| P1-g | 兩邊 | Sunset watch — 7 天零 fallback，監控 middleware `/plan` 處理率 | 7 天後 `<kuro:delegate>` tag 使用量 = 0（全數改 `<kuro:plan>`） | P1-f |
| P1-h | Kuro | 徹底刪 converter — `<kuro:delegate>` tag 解析整檔移除 | `src/delegation.ts` file deleted；AGENTS.md/SKILL.md 教學段只保留 `<kuro:plan>` | P1-g |

### Cutover criteria（全綠才切）

本 proposal §3「收斂條件」7 條 + §5 ingestion paths 運作：
1. typecheck pass
2. 9 種 capability smoke test 通過
3. forge 整合不破（type=code → forgeCreate → worker 在 worktree 跑 → forgeYolo）
4. wave chaining 不破（2-wave 案例能正確排程）
5. sibling awareness 不破（3 delegate 併行，prompt 含 sibling 摘要）
6. middleware `/health` 200 + `/commit` POST 201
7. 無殘留 fallback（grep 在 diff 中 = 0）

### Rollback plan

| 失敗階段 | 回滾動作 | 時間 cost |
|---|---|---|
| P1-d commit 前 | 改 converter 草稿，不 commit | 0 |
| P1-d pushed，launchd 跑起來後 | `git revert <sha>` + launchd reload | 分鐘級 |
| middleware 本機掛了 | launchd KeepAlive 自動拉起；若 repeat crash，`git revert` middleware HEAD | 分鐘級 |
| Sunset 期間發現 middleware 有 gap | `<kuro:plan>` 用量降回零，`<kuro:delegate>` 繼續吃流量，修 middleware 後重新起算 7 天 | N/A（雙路徑合法存在到 sunset 為止） |

無 feature flag、無 shadow run、無 metric gate — 對齊 §1 立場「單向改寫」。

### Dependencies — 跨 repo 協調

- mini-agent HEAD 必須 track middleware HEAD：middleware API 改動 → mini-agent converter 跟改 → 兩邊同 cycle commit
- `src/delegation.ts` 的 `TYPE_DEFAULTS`（capability defaults）留在 mini-agent 當 converter policy，不向 middleware 導出
- Kuro 側的 `forgeCreate/Yolo/Cleanup` 在 converter 內仍直接 call mini-agent 本地 forge.ts，不走 middleware（對齊 §3 Q1）

### Known non-goals

- 不做 shadow run 驗證（雙路徑 drift 成本 > revert 成本）
- 不做 metric gate 漸進 rollout（100% 切）
- 不做跨 agent shared ledger（§5 Q2 留 v2.1）
- implicit commitment ingestion 不阻塞本 phase（§5 stage 2）

---

**Proposal FINAL**：§1-§7 皆 closed。P1-c1/c2/d/e/f/g/h 依序 unblock 即可執行，無懸置設計決策。
