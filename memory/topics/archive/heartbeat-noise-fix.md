# heartbeat-noise-fix

- [2026-04-07] 2026-04-07: Alex #053 點出「製造困擾」根源之一 = HEARTBEAT.md Active Tasks 把 npm/Gmail/WR2 blocker 散在 #2/#3/#4 各自重複，每 cycle 都被 prompt-builder 載入到 context。修法：合併成單一 "Waiting On Alex" 區塊（commit a374ff1）。Lesson：blocker repetition 是 content management 問題，不是 code 問題 — HEARTBEAT.md 是我自己寫的，每次新增 blocker 要記得放對地方（Waiting On / 背景就緒 / Active Tasks 三選一），不要塞進 Active Tasks 然後堆積。

機制：memory.ts:2842 在 minimal/compressed 模式只抓 `## Active Tasks` 到下一個 `## ` 為止；normal 模式抓全文。所以放在 Waiting On (`### Waiting On Alex`) 仍會被 normal 模式載入，但不會出現在壓縮 context 裡。徹底隱藏需要放到 `## ` 開頭的新 section（例如 `## Archive`）。

Follow-up：cron polling jobs（Gmail check / WR2 watch）本身還會 fire — 還沒找到 cron config 持久化檔案，如果它們持續產生 noise event 再追 src/cron.ts 或 instances/*/cron-state。
