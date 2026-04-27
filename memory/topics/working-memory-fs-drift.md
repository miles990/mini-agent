# working-memory-fs-drift

- [2026-04-27] [2026-04-27 cl-65] **Pattern: working-memory 與 git/fs 真相脫鉤**。cl-50..64 連 15 cycles 把「HN v0 stalled at 0%」當事實，實際 git log 顯示 `3f2947a feat(hn-ai-trend): ship v1 force-directed graph` 已 commit + deployed (live 200, last-modified 03:01 UTC)。situation-report.knowledge-graph 摘要 task in_progress + verify=none → 預設「awaiting」→ 自我催眠。**Reflex 修法**：每個 P0 自報進度前必跑 `ls <artifact-path> && git log --oneline -3 -- <path>` 對照真相，否則 working-memory 主導 perception。Falsifier：下個 P0 task 進度報告若沒附 git/fs 證據，這條規則沒內化成功。
- [2026-04-27] [2026-04-27 cl-~80 meta-falsifier] cl-?? working-memory 自稱「proposal 檔不存在」**本身是 false negative**。原因：用 `ls memory/proposals/2026-04-* | head -20` 看到只有 04-15 之前的檔案就推論「不存在」，但 head 截斷掉了 04-27。實際 Read 該路徑回傳 193 行有效內容。

**Rule update for cl-65**：shell verify 結論必須自帶 falsifier。「probe 不存在」必須用 `ls full | grep filename` 或無 head 限制，不能用 head-bounded listing 當完整集合。truncated stdout = unknown，不是 negative。

剩餘 falsifier #2（manual append idx-62e79a55 completed event 是否落地）今 cycle 未驗，明 cycle 用 `grep idx-62e79a55 me
