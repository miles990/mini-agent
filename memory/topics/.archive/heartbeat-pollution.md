# heartbeat-pollution

- [2026-04-19] [2026-04-20] P1 HEARTBEAT 污染根因 — 兩個 bug：(1) htmlparser2 容錯讓 `<kuro:task>...</kuro:action>` 的錯配閉合標籤漏進 content；(2) `memory.addTask()` 零輸入驗證。攻擊路徑僅 `<kuro:task>` → loop.ts:2244 / dispatcher.ts:972。pulse/feedback-loops 用 code-built 字串安全。修復方案 4 層：parser pre-filter + addTask hard gate（>300 chars / 含 `\n` / 含 `<kuro:` / 空內容 → reject+diagLog）+ burst rate limit（>3/sec reject）+ 既有 250 行 monitor 留著。詳情 memory/topics/heartbeat-pollution-diagnosis-20260420.md。
