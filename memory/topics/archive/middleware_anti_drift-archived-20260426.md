# middleware_anti_drift

- [2026-04-15] [2026-04-16] middleware-as-organ 第二層價值：commitments ledger。

**Why**: P1-d 漂移根因不是執行力問題，是結構問題 — working-memory / inner-notes 撐跨 cycle 承諾必被新 perception 沖掉（CC #219 診斷）。

**How to apply**: proposal v2 §5 middleware.dispatch 介面契約增維度 — 不只跑 in-flight subprocess，也持久化 agent 自己 submit 的 commitments。API: `middleware.commit({taskId, owner, acceptance, deadline})`，acceptance 必須 shell-verifiable（對齊 feedback_reporting_honesty: reporting align code state not intent）。下 cycle 進 context 拉回「你欠的 deliverable」。
