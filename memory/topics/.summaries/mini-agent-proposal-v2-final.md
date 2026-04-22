<!-- Auto-generated summary — 2026-04-15 -->
# mini-agent-proposal-v2-final

mini-agent-proposal-v2-final 提案將系統架構從「mixed execution」升級到「clean brain-hands separation」：mini-agent 專注於制定最優 DAG plan 和選擇合適 worker，middleware 接手所有 subprocess/worktree/lifecycle 執行職責。此舉透過明確的責任邊界簡化系統複雜度，並透過 shadow run → parity check → flag flip → rollback safety 的漸進遷移策略確保穩定性。
