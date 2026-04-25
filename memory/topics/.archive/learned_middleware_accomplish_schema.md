# learned_middleware_accomplish_schema

- [2026-04-17] POST /accomplish payload schema：`goal`（必填 string）不是 `task`；`type` 是 capability hint 但 brain planner 會覆寫；`timeout_ms` optional。
wrong：`{"task":"echo x"}` → 400 "goal (string) required"
right：`{"goal":"echo x","type":"shell"}` → 200 + planId + DAG
回傳物有 `planId` / `status=executing` / `plan.steps[]`（worker + dependsOn + acceptance_criteria）
驗證方法：`curl -sS -m 30 -X POST localhost:3200/accomplish -H "Content-Type: application/json" -d '{"goal":"...","type":"shell"}'` 該看到 planId 就是活的。
