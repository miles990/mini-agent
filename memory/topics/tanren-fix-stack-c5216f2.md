# tanren-fix-stack-c5216f2

- [2026-04-12] Tanren 4-layer fix stack 完成（2026-04-12 09:44）：
1. aab7148 — SDK PreToolUse hook 硬限（canUseTool 僅對危險操作）
2. ce81705 — runChain convergence（chainTicks 機制）
3. 95d1377 — respond semantic + drift detection
4. c5216f2 — memory + merge 根因（agent actively declares converged:yes）

關鍵 CT 原則驗證：framework ask → agent actively declare（不是 implicit/default）。Akari in-vivo 報告證實 behavioral shift 已內化（"respond is FINAL report only"）。Plan plan-1775986321609-q, 4 steps, 253.9s, scan+deps 18ms gap 並行驗證成功。

TODO（非急迫）:
- GET /plan/:id 應回 dependsOn（API 不一致 vs GET /plans）
- shell worker glob 加 compound command 會破
- 加 plan-level createdAt 欄位
