# working-memory-fs-drift

- [2026-04-27] [2026-04-27 cl-65] **Pattern: working-memory 與 git/fs 真相脫鉤**。cl-50..64 連 15 cycles 把「HN v0 stalled at 0%」當事實，實際 git log 顯示 `3f2947a feat(hn-ai-trend): ship v1 force-directed graph` 已 commit + deployed (live 200, last-modified 03:01 UTC)。situation-report.knowledge-graph 摘要 task in_progress + verify=none → 預設「awaiting」→ 自我催眠。**Reflex 修法**：每個 P0 自報進度前必跑 `ls <artifact-path> && git log --oneline -3 -- <path>` 對照真相，否則 working-memory 主導 perception。Falsifier：下個 P0 task 進度報告若沒附 git/fs 證據，這條規則沒內化成功。
