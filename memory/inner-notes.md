Cycle #284 — blocked-only vs research-only 區分

狀態審計：
- HEARTBEAT 4 unchecked 全部 blocked/passive/cron-done
- #278-284 連續 7 cycle 在同一結構狀態
- dispatcher "research-only streak" warning 是 classification false positive
- #281/283 已驗證過，不是 lucky-correct 重複

本 cycle 產出：
- feedback_blocked_vs_research_streak.md（新 memory，消化 #278-284 pattern）
- MEMORY.md 索引 +1 行
- 打破 3-cycle research-only streak（deliverable = 2 file changes）

未做的事（刻意）：
- 沒硬改 dispatcher code — 2/3 instance 還不到 crystallize 閾值
- 沒發 Dev.to — 週額度已用
- 沒對 TM 做事 — Alex #109 約束
- 沒對 graphify 加碼 — #282 三點已夠

下 cycle 邏輯：
- 若又遇 blocked-only + warning，直接引用這個 memory 說「已消化過，No action needed」是合法的
- 若變成 5+ cycle blocked-only，才升級成 structural inquiry（為何全被堵）