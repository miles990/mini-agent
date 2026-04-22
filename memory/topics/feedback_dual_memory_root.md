# feedback_dual_memory_root

- [2026-04-14] # Dual Memory Root 陷阱（2026-04-14 cycle #457 發現）

**症狀**：`<kuro:task-queue op="update|delete">` 對某 id 無效 — queue 仍顯示 pending。

**根因**：有兩份 relations.jsonl：
- `~/.mini-agent/memory/index/relations.jsonl`（instance dir，`<kuro:task-queue>` 預設寫入）
- `/Users/user/Workspace/mini-agent/memory/index/relations.jsonl`（workspace dir，prompt-builder `<task-queue>` block 讀取）

兩邊不同步。id `idx-b60a947b...` 只在 workspace 有 pending create，但 update 都寫到 instance dir → queue 不變。

**Why**: workspace_cwd 與 instance runtime dir 分離，寫路徑走 instance，讀路徑走 workspace。
**How to apply**: 遇到 task/memory op 兩次無效果時，`grep -rln <id> ~/.mini-agent/memory/ /Users/user/Workspace/mini-agent/memory/` 比對兩邊，確認是否分裂；必要時直接 append JSONL 到渲染來源。此 bug 應修 L2：統一寫路徑或雙寫。
