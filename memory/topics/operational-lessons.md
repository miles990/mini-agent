# operational-lessons

- [2026-04-19] [2026-04-20] HEARTBEAT.md writer-pollution event: 4/19 18:07-18:45 某 writer path 把 LLM response body 當 task 項目 append，file 從 41 行爆 6517 行。症狀：`- [ ] </kuro:action>`、`- [ ] because the task was not part of the conversation history`、`- [ ] constraint to solve the task; I am treating it as a directive` 重複 x7+ 出現在 Active Tasks。清理 commit `48ca4996`。Backup 留 `memory/HEARTBEAT.md.corrupt-backup-20260420`。P1 task 追 writer。**教訓**：HEARTBEAT file size 本身就是健康信號 — 超過 ~300 行幾乎肯定有污染，加到 self-diagnosis check。
