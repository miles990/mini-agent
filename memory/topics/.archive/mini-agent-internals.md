---
related: [agent-tools]
---
# mini-agent-internals

主要改動：(1) Strategic Anchor — 每 cycle 開始問「做什麼之後會讓很多其他事變容易」(2) Action Memory — 向內感知，追蹤自己用了什麼工具 (3) Output Gate — 連續 3+ cycle 無產出時阻止 delegate spawn (4) FG lane 升級為完整 deep-thinking (5) Playbook 機制內建 prompt。
學習循環：c099f96 移除 capability-suppressing constraints → 效果不好 → 03baf1b revert 恢復。結論：某些 prompt constraints 看起來限制但實際上是有用的 discipline guard。
- [2026-03-22] **週回顧：Multi-lane 競態條件的 Ownership 模式** — 本週修了 5 個並行 lane 重複處理 bug（50ff581, 20c6f06, 927a28b, be122da, 266618f）。根因分析：三個獨立入口（Event-Router, Task-Graph, Inbox-Reader）路由同一條 Chat Room 訊息，沒有協調 ownership。

  **演化路徑**：(1) mark-as-seen（非同步 flush，有 timing gap）→ (2) Claim-on-Route（三層 fix：inbox claim + trigger downgrade + context annotation）→ (3) sender-level intent dedup（同 sender 多訊息合併）→ (4) Atomic MessageClaimer（同步 Map，消除 async gap，10min TTL crash safety）。

  **核心洞見**：有機並行的 Physarum 模型在實作中碰到了「觸手感知其他觸手」的問題。理論上每條觸手獨立探索，但當兩條觸手碰到同一個養分源（同一條訊息），沒有 ownership 協調就會重複處理。解法不是減少觸手，是加入 claim 機制 — 先摸到的人擁有，其他人退讓。這跟分散式系統的 leader election / distributed lock 同構，但在單機多 lane 的場景用同步 Map 就夠了。

  **與 ISC 的連結**：Google Research 的 multi-agent 通訊拓撲研究（independent agents = 17.2x 錯誤放大）在我們自己的系統中被驗證了 — 不是靠讀論文，是靠踩坑。通訊拓撲（= ownership 協調結構）就是約束，缺少這個約束 = 重複處理 = 浪費 + 用戶體驗差。

  **行動結晶**：MessageClaimer pattern 已穩定。如果未來加更多 lane 類型，claim 機制需要擴展但核心設計（同步 Map + TTL expire）不需要改。
- [2026-04-15] [2026-04-16 04:18] delegation.ts P1-d 實況測量（honest baseline）：1431 行 / 17 exports / 僅 9 個真的被 import / 4 callers (dispatcher/pulse/api/loop)。Q-S1=A 下 converter ~30-50 行要涵蓋的 symbol：spawnDelegation(主), listTasks, cleanupTasks（核心 4 個）+ 5 個 forge/watchdog（待 CC 確認 middleware 是否吃掉）。commitments.ts 273 行撞名（mini-agent 既有 self-commitment tracker vs CC 新 cross-agent ledger），(A)/(B)/(C) 仍 pending CC。
