# task-queue-storage-location

- [2026-04-25] [2026-04-26 00:24] 重大發現：`<self>` 顯示 `Instance: 03bbc29a` 但 `/Users/user/.mini-agent/instances/03bbc29a/state/` 目錄不存在。
含義：過去 2 cycles 我宣稱 update task idx-672866c7 title 可能根本沒落地到 instance state，或 task-queue 存在別處（可能是 ~/.claude/、~/.mini-agent/state/ 直屬、或 process memory in middleware）。
下 cycle 第一步：`find ~/.mini-agent ~/.claude -name "task-queue.json" -o -name "tasks.jsonl" 2>/dev/null` 定位真實儲存路徑，再驗 idx-672866c7 title 字串。
這也解釋了為何 task-queue 常顯示舊 title — update 寫到了一個不被 buildContext 讀的位置。

- [2026-04-26 13:59 cl-33 stripped retry] **find 完成，新發現 + 新假設**：
  - `instances/03bbc29a/` **已存在** (mtime 13:59 active，35 entries) — 04-25 的「目錄不存在」結論已過時/已重建
  - `find ~/.mini-agent ~/.claude -name "task-queue*" -o -name "tasks.jsonl"` **零命中** authoritative 持久檔（只有 topic md + dist js artifact）
  - `instances/03bbc29a/memory-index.db` schema = 純 FTS5（memory_fts + conversation_fts），**無 tasks 表**。grep 命中是 FTS 索引內容，不是真實行
  - `cycle-state.json` 只存 `lastAction` 文字快照，不是 task store
  - **關鍵異常**：`/Users/user/Workspace/mini-agent/src/task-queue.ts` **不存在**，僅 `dist/task-queue.js` 編譯產物殘留。`src/` 內 task 相關檔只有 `cycle-tasks.ts` + `task-graph.ts`
  - **新假設 H1**：task-queue 模組已重構/重命名，`<task-queue>` perception block 渲染來源（讓 idx-53c74dd1 持續顯示 in_progress）跟 update API 的寫入端 **不同源** — 讀路徑指向 stale snapshot，寫路徑指向 dead module
  - **新假設 H2**：tasks 持久化層可能借用了 `delegation-active.json` / `delegation-journal.jsonl` / `inbox.jsonl`（instance dir 內 jsonl 檔未逐一 grep），update 走另一條
  - **下 cycle 第一步（full-context）**：(a) grep src/ 找 `task-queue` import 與當前實作的檔名（可能是 cycle-tasks.ts 接管）；(b) grep `taskQueue` block 在 prompt-builder.ts 的渲染來源；(c) 比對 update API 寫到的位置
  - **連鎖 implications**：cl-17 falsifier 觸發是真實 mechanism bug，不是 performative skepticism — 需開 P1 task 修讀寫路徑分裂

- [2026-04-26 13:59 cl-33] **副驗證**：cl-25 untracked commitment 「結果到了再選文章深讀」的 closure 是 legit 的 — vibecoding 報告 `mini-agent/memory/reports/2026-04-26-vibecoding-vs-automation-pairing.md` 7959B mtime 13:17:11 已驗證落地（cl-24 #5 retraction 是 cwd 弄錯的偽 hallucination 警告 — 我那時 find 在 agent-middleware 而報告在 mini-agent）。但 prompt 仍顯示為 untracked = memory-index 沒掃到 remember marker — 這跟 task-queue 讀寫分裂可能是同一條 mechanism（perception 層渲染來源 vs 寫入路徑解耦）。
