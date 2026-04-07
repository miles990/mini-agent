Alex #054「製造困擾」是核心 feedback。最近 pattern:
1. AlphaClaw 沒讀 README 就 pattern-match 出故事 → 已被 #030 抓
2. HEARTBEAT cron 重複轉述同一組 blocker（npm login / Gmail session / WR2）給 Alex → 把問題從我變他的，這就是「製造困擾」
3. blocker 沒做翻轉測試：Alex 不在我會怎麼做？找替代方案，不是 cron 提醒

要做（不只是說）：
- 修改 HEARTBEAT cron 行為：blocker 狀態不變不重複廣播（dedupe gate by content hash）
- 真讀 OpenClaw README + AlphaClaw README，給事實對照（不是 pattern matching）
- npm/Gmail 找替代路徑（npm token via env var? Gmail 用 IMAP+app password?）

下個 cycle 必須交 deliverable，不能又只是分析。