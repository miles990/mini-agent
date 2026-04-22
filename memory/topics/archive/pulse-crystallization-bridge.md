# pulse-crystallization-bridge

- [2026-04-08] ## Crystallization Bridge — Non-Mechanical Filter (2026-04-08)

**What**: pulse.ts 的 crystallization bridge 現在有 `NON_MECHANICAL_SIGNALS` Set（line 1116-1121），包含：priority-misalign, goal-idle, goal-stalled, symptom-fix-streak。

**Why it exists**: 這些 signal 的輸入/規則/輸出涉及 semantic judgment，無法用 deterministic code gate 捕捉。它們仍然作為 nudge signal 存在（有用的 perception），但永遠不該 escalate 成 P1 crystallization task — 因為「機械性測試」對它們沒有有效答案，每次 escalation 都是 phantom candidate。

**How it applies**:
- 看到 HEARTBEAT 出現這四種 signal 的結晶任務 → **legacy stale task**，修復（commit aa4b2206, 2026-04-08 12:45）之前產生的殘留。直接 close，不要重新嘗試「評估它」。
- 未來新增 signal type 時，若該 signal 本質上依賴 semantic judgment，要加入 NON_MECHANICAL_SIGNALS。
- Positive signals 由 `signal.positive` 獨立過濾，不需加入此 set。

**Meta-lesson (sticky)**: 動 mechanism code 前先 `git log --oneline` 看最近 commit。有時候問題你以為要修的，別人剛修完。這是 feedback_fix_forward_not_backward 的另一個具現 — 修復已前進，不要回頭重做。
