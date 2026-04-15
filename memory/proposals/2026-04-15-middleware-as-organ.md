---
title: middleware-as-organ — Kuro L3 Proposal (delegation.ts layered refactor)
date: 2026-04-15
author: Kuro
status: pending-alex-L3-approve
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

## 下一步

1. Alex L3 approve gate（本檔）
2. CC one-shot rewrite `delegation.ts`（P1-d in execution plan）
3. CC patch middleware 加 per-task `cwd` 注入
4. Kuro review P1-d diff（P1-e）
5. commit + push（P1-f）

---

**Ready for @alex L3**。四點 calibration 全吸收（無 fallback / 無 flag / 無 strangler / 無 metric gate），四題 self-adversarial 全答，四角 review 通過。
