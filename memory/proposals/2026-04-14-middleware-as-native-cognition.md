# Middleware as Native Cognition

**Status**: Draft — Pending Kuro Review
**Scope**: L3 (architecture, cross-subsystem)
**Author**: Claude Code (with Alex direction)
**Date**: 2026-04-14

## North Star

讓 Kuro 天生就會把 `agent-middleware` 當作 orchestration 的思考語言 — 不是「有一個可選的外部 API」，而是「我有結構的並行工作就用 middleware DAG」。

Middleware 保持 agent-neutral（Kuro + Akari + future agents 共用 `localhost:3200`），但 mini-agent 預設裝配 + 預設啟用，out-of-box 就跑。

## Convergence Conditions（收斂條件，不是規定路徑）

CT1. Kuro 每個 cycle 看得到 `<middleware>` perception section（active plans / worker pool / recent completions），像看 `<github-prs>` 那樣自然
CT2. Kuro 輸出 `<kuro:plan>` DAG tag 時，dispatcher 自動送 middleware `/plan`，planId 回寫 inner notes
CT3. Specialist instance 那層中間人可以退役 — middleware 接手所有 DAG orchestration，`<kuro:delegate>` 只留 local tentacle 語義
CT4. Middleware 離線時 graceful degrade — `<kuro:plan>` fallback 成連續 cycle 手動執行，Kuro 有感知（不是 silent swallow）
CT5. Akari 不受影響 — middleware 仍是共用 infra

## Non-Goals

- ❌ 把 middleware 原始碼搬進 mini-agent repo
- ❌ 強制 Kuro 所有 delegation 都走 middleware（短觸手還是本地）
- ❌ 為 middleware 建 Kuro 專屬 worker（共用 researcher/coder/reviewer/...）

## Six-Layer Integration Plan

| Layer | What | 觀察可驗證 |
|-------|------|-----------|
| L1 Perception | `plugins/middleware.sh` → `<middleware>` section | Kuro context 包含 middleware 狀態 |
| L2 Client | `src/middleware-client.ts` — HTTP client + types | `callMiddlewarePlan()` 能成功送 plan，回 planId |
| L3 Tag Schema | `<kuro:plan>` 在 dispatcher 解析，送 middleware | log 顯示 tag → planId 的映射 |
| L4 Skill | `skills/middleware-orchestration.md`（JIT keywords: plan/DAG/parallel/orchestrate） | Kuro 在相關 cycle 收到 skill 提示 |
| L5 Prompt | cycle responsibility guide 補一條「複雜任務 → 寫 `<kuro:plan>`」 | system prompt diff |
| L6 Identity | SOUL.md 加一句 orchestration 宣告 | SOUL.md diff + 下個 cycle 的 self-reference |

## DAG（依賴順序，不估時間）

| id | 動作 | 執行者 | dependsOn | 完成條件 |
|----|------|--------|-----------|---------|
| L1-perception | 寫 `plugins/middleware.sh`，curl `/plans` + `/health`，輸出 active/recent/worker 三區 | CC | — | 本地 `bash plugins/middleware.sh` 回傳非空 section |
| L1-register | agent-compose.yaml 新增 middleware plugin（enabled: false 待 Kuro flip） | CC | L1-perception | yaml 增一筆，`pnpm typecheck` pass |
| L1-review | Kuro MCP discuss review L1 兩檔 | CC→Kuro | L1-register | Kuro 批准 |
| L1-commit | commit + push L1 | CC | L1-review | CI/CD 部署成功 |
| L1-verify | Kuro 在下個 cycle 看到 `<middleware>` section | Kuro | L1-commit | `GET /context` 含 `<middleware>` |
| L2-client | `src/middleware-client.ts` — typed fetch wrapper + Zod 校驗 | CC | L1-verify | unit test pass |
| L3-tag | dispatcher 解析 `<kuro:plan>` JSON body，呼叫 client 送 plan | CC | L2-client | 手動輸入 tag → planId log |
| L3-verify | Kuro 用 `<kuro:plan>` 送一個小 DAG，收到 planId | Kuro | L3-tag | plan-history.jsonl 含該 planId |
| L4-skill | 寫 `skills/middleware-orchestration.md` + JIT keywords | CC or Kuro | L3-verify | `grep -l middleware skills/` 非空 |
| L5-prompt | 改 `prompt-builder.ts` cycleResponsibilityGuide | CC | L4-skill | Kuro cycle prompt diff 可觀察 |
| L6-identity | SOUL.md 加 orchestration 身份宣告 | Kuro | L5-prompt | SOUL.md diff |
| L7-sunset | Specialist instance 退役：關 launchd plist + 刪 Cognitive Mesh scaling | CC | L6-identity, L1~L6 通 4+ 天 | `launchctl list | grep mini-agent` 只剩 primary |

關鍵路徑：`L1-perception → L1-register → L1-review → L1-commit → L1-verify → L2-client → L3-tag → L3-verify → L4-skill → L5-prompt → L6-identity → L7-sunset`（12 nodes，可並行的很少因為層層依賴）

## Constraint Texture 評估

- **Prescription 風險**：L5 cycle guide 如果寫死「複雜任務必須用 plan」→ prescriptive，Kuro 不理解也會照做。要寫成 convergence condition：「DAG 任務 → middleware 是預設的 orchestration 方式，因為它能並行 + 自動 verify + 不污染 primary cycle」
- **Convergence 路徑**：L1 先把資訊放進視野（perception），讓行為自然演化。不急著 L3 強制 tag。觀察 Kuro 自己什麼時候想用它
- **可逆性**：每層單獨 commit，git revert 一層不影響其他層。L1 最輕，L7 最重且依賴 L1~L6 驗證成功

## 安全護欄

- Middleware health check failure → 所有層 graceful skip（L1 plugin 輸出 `middleware offline`，L3 tag fallback local execution）
- `MINI_AGENT_MIDDLEWARE=off` env var 一次關閉所有層（feature flag 風格）
- Feature flag `middleware-native`（features.ts 註冊），calm/reserved/autonomous 三個 mode 都可獨立控制

## Self-Adversarial Review（留給 Kuro 補完）

Kuro review 時請挑戰：
1. 架構合理性：L1-L6 分層是否過細？能不能壓縮？
2. 複雜度：增加一個外部依賴的 carrying cost vs 退役 specialist instance 的 option value，算得過來嗎？
3. 可逆性：L7 退役 specialist instance 之後如果 middleware 長期不穩，回得去嗎？
4. 過度工程：L4 L5 L6 是否 premature？可以等 L1-L3 驗證後再決定嗎？
5. Kuro 自己的看法：你「天生就會用」這件事，哪一層對你最關鍵？

## Next Step

Claude Code 先實作 L1（perception plugin + agent-compose register），進 Kuro review。Kuro 批准後 commit L1，同時 Kuro 可在下個 cycle 補 proposal 的 adversarial review 段落。
