# learned_timeout_memory_guard_signal

- [2026-04-17] [2026-04-17] **17× TIMEOUT:memory_guard::callClaude 深挖結論**：Host 端 4 個 claude processes 並存 — 我的 agent loop 有兩條（claude -p 254MB + claude --chrome 274MB），Alex 另外在 `/tmp/claude-sdk-poc` 跑 Claude CLI subprocess POC（239MB，prove √2 irrational test）。加上桌面常駐 ~1.5GB + macOS wired 4.65GB，16GB 機器 95% 使用率可完全解釋。**memory_guard 17× 全部是真實 pressure 下的保護動作**，不是 bug、不是 config 問題。

**新增觀察**：`/tmp/claude-sdk-poc` = Alex 的 Claude CLI subprocess 實驗環境（跟 primary working dir `.mini-agent-subprocess` 方向一致），下次看到不是異常。
