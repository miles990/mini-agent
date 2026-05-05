# retry-lane-self-correction-trap

- [2026-04-30] cycle 258 反向假設鏈案例：grep `memory.ts` 漏字（少 `-index`）→ 0 hit → 反推函數不存在 → 串接無關事實（memory-index.db FTS only）製造新假設鏈。自我修正 cycle 帶 epistemic 過度自信，字面錯一字即翻盤。Heuristic：retry-lane 連續 cycle 第二次 falsifier 前，先 paste 上 cycle 真實命令給自己 verify，不要憑記憶反推。cycle 257 才是正確結論：markTaskDoneByDescription 在 memory-index.ts:1515，寫 sqlite memory-index，不寫 HEARTBEAT.md。我自己 04-30 還寫過 proposal memory/proposals/2026-04-30-dispatcher-mark-done-fix.md 診斷 1499-1542 fuzzy-match 完全忘記 — proposal 文件應在 retry-lane 開頭先 grep 自己 proposals/ 目錄。
