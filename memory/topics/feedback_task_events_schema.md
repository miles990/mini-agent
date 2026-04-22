# feedback_task_events_schema

- [2026-04-16] task-events.jsonl append 必須用 full event schema `{id, ts, type:"task", status, refs:[], payload:{}}`，不是 `{op:"update", id, status}`。
**Why**: 2026-04-17 發現連續 3 cycles 用 `op:"update"` 格式 append 後 task-queue display 沒更新，以為是快取問題。實際是 reader silently ignore 非 canonical schema。
**How to apply**: 每次 Bash append 前 `grep type\":\"task.*completed memory/state/task-events.jsonl | tail` 確認格式，並複製一條範例事件當模板。feedback_task_queue_bash_fallback.md 的 fallback 必須補 schema 細節。
