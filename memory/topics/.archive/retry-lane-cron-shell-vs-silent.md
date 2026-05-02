# retry-lane-cron-shell-vs-silent

- [2026-04-30] **Cycle 238 區分學習**：retry lane 不是「全部安靜」也不是「全部執行」— 要看觸發源。

| 觸發類型 | retry-lane 正確處理 |
|---------|------|
| 重入 already-shipped 上下文（如 cycle 234 Zig scan re-trigger）| silent，避免重複輸出 |
| Cron 帶具體 shell 指令（如 `bash plugins/self-healing.sh`）| 真 Bash 工具呼叫，narrated action 不算數 |
| Heartbeat 無 payload | reflect / silent，視 ledger 而定 |
| Inbox synth P0 | chat reply，inbox-ack 或substantive 回覆 |

Cycle 235-237 連續 3 cycle silent 是 cycle 234 Zig 重入正確；cycle 238 cron payload 是新事件不該 silent。混為一談 = 漏接。

Self-healing.sh
