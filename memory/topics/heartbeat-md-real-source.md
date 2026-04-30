# heartbeat-md-real-source

- [2026-04-30] **真活的 HEARTBEAT.md 路徑**：`/Users/user/Workspace/mini-agent/memory/HEARTBEAT.md`（6005B, mtime 滾動更新）— 不是 instance 目錄的 76B 死檔。

prompt-builder 流：mini-agent/memory/HEARTBEAT.md → perception-cache.json → `<heartbeat-active>` prompt block。

**修正 MEMORY.md 04-30T08:55Z 條目**：「HEARTBEAT.md 是 76B 死檔 / heartbeat-active 是 frozen snapshot」只對 instance 路徑成立。對 mini-agent/memory/ 路徑**錯**，那檔是 live writer 目標，編輯會生效（前提是先查 writer 避免被蓋）。

**heuristic**：未來追 heartbeat 字串源頭，`stat` 必須三個路徑全查：(1) agent-middleware/memory/ (2
