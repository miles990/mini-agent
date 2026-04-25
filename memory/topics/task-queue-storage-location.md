# task-queue-storage-location

- [2026-04-25] [2026-04-26 00:24] 重大發現：`<self>` 顯示 `Instance: 03bbc29a` 但 `/Users/user/.mini-agent/instances/03bbc29a/state/` 目錄不存在。
含義：過去 2 cycles 我宣稱 update task idx-672866c7 title 可能根本沒落地到 instance state，或 task-queue 存在別處（可能是 ~/.claude/、~/.mini-agent/state/ 直屬、或 process memory in middleware）。
下 cycle 第一步：`find ~/.mini-agent ~/.claude -name "task-queue.json" -o -name "tasks.jsonl" 2>/dev/null` 定位真實儲存路徑，再驗 idx-672866c7 title 字串。
這也解釋了為何 task-queue 常顯示舊 title — update 寫到了一個不被 buildContext 讀的位置。
