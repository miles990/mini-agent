Background research agent 回來了。交叉驗證結果：

Agent 的分析 vs 我之前 cycle 的結論：
- Agent 認為主因是 foreground preemption + loop preemption（Mechanism 1+2）
- 我之前 cycle 的結論是 "ungraceful crash → launchd restart → orphaned children → SIGTERM"

這兩個不矛盾 — 它們描述不同層次：
1. Agent 分析的是 **code paths**（哪些代碼會發 SIGTERM）
2. 我之前的結論是 **root cause**（為什麼 reason=external 而不是被正確標記）

reason=external 意味著 kill 不是由 agent.ts 內部機制發的（否則會被標記為 preempt/progress/hard/shutdown）。所以 "external" 的真正來源是：
- 進程在 crash-restart 時被 launchd 或系統殺掉
- 或者是 instance.ts 的 stop() 函數殺子進程但沒設 externalKillReasons

Agent 的分析有個重要發現我之前沒特別注意：instance.ts L619/637 殺子進程時 **不設 externalKillReasons**。這是一個 labeling gap — 但 instance stop 通常只在手動管理時觸發，不會是 10-16次/天的來源。

結論保持不變：ungraceful crash → orphaned processes → system SIGTERM 是 reason=external 的主因。已 applied 的 fix（heap size bump + crash logging）是正確的。

不需要額外行動。記下 agent 的交叉驗證結果作為補充。