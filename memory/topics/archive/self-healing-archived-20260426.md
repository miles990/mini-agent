---
related: [self-evolution-foundations]
---
# self-healing

- [2026-03-09] 重複回答舊訊息 bug 修復（2026-03-09, commit 8e14646）：兩個 root cause — (1) inbox-processor.ts getRoomReplyStatus() 只載今天的 JSONL，#NNN 短 ID 盲猜今天日期拼 fullId，跨日訊息永遠匹配不上 (2) cycle-tasks.ts room threads 受 24h TTL 自動過期，過期後系統以為是新訊息。Fix: 載今天+昨天 JSONL + shortId→fullId map、room threads 豁免 TTL。高流量時 bug 疊加效果放大（anima 開發期間 150+ msgs/day）。
- [2026-03-10] 重複回文 bug 第二次修復（2026-03-10, loop.ts:442）：根因是 foreground lane 回覆 room 訊息後沒呼叫 markChatRoomInboxProcessed()，main cycle 還是看到 Pending 訊息又回一次。Fix: foregroundReply() 結束處加 markChatRoomInboxProcessed(response, parseTags(response), 'foreground-reply')。第一次修復（8e14646）解決的是跨日 JSONL + TTL 過期問題，這次解決的是 lane 間 dedup。兩個 root cause 不同但症狀相同（重複回文）。
- [2026-03-11] 2026-03-11 daily review: self-healing plugin 28 次 timeout/天，是最大 noise source。circuit-breaker 在 doubling interval 但治標不治本 — plugin 執行的 health check 本身就超過 10s timeout。需要調高 timeout 或簡化 check 邏輯。P2 due 03-13。
- [2026-04-05] **週回顧：Silent Drift — 標籤與行為脫鉤**。本週發現 omlx-gate data-driven pruning 壞了 5094 cycles（~70天）：`totalCycles` vs `cycleCount` 欄位名不匹配，永遠 fallback 到靜態清單。同期還有：CT 詞彙當裝飾（`detectThreadConvergence()` 是 static constant）、`classifyError()` 不讀 error.cause。共同結構：proxy measures（uptime, no crashes）正常，但 functional correctness 已漂移。
  **研究發現**（Pathak et al. arXiv 2511.04032 + Conf42 SRE 2026 + chaos engineering）：五類 silent failure（drift, cycles, missing details, tool failures, context propagation）。最可實作的防禦：
  (1) **Fallback counter** — 每個 fallback/default path 計數，100% fallback = feature 已死（本週 bug 第一天就會被抓到）
  (2) **Golden-answer canary** — 每 N cycles 注入已知輸入，驗證 data-driven path 產出與 static default 不同
  (3) **Label-behavior audit** — 定期斷言名為 "dynamic"/"adaptive"/"convergence" 的函數實際產出有變異
  (4) **Path coverage logging** — 追蹤 branch 執行率，100+ cycles 零執行 = dead or broken
  **CT 連結**：這是 **constraint-label decoupling** — 系統的 self-model 與 actual topology 脫鉤。需要 **self-verifying constraints**：約束本身包含驗證自身是否被滿足的測試。
