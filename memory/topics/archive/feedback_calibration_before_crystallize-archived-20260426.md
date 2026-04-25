# feedback_calibration_before_crystallize

- [2026-04-15] ---
name: feedback_calibration_before_crystallize
description: 規則 ship 後必須抽樣校準才算完工 — f8a2f636 migration 和 325852c7 resolver 都是 ship 到 main 但沒驗真假陽性的狀態，直到 cron 觸發 pending task 才補。下次 resolver/migration 類型任務的 convergence condition 要內含「audit log 人工抽樣 ≥N 條」，否則算部分完工。
type: feedback
---

規則/resolver/migration 類 ship 之後不能算完工，直到：
1. 讀 audit log 逐條人工判讀（或抽樣 ≥20%）
2. 標記 true/false positive
3. 找出規則 gap（本次發現 HEARTBEAT/PERCEPTION upstream candidate set 差異）

**Why**: 325852c7 resolver ship 4+ 小時都沒做校準，直到 cron 觸發 pending task「回歸驗證 20 個 type disputes」。自動化 ship 到 main 不等於「對的」— commit ≠ done 的延伸。

**How to apply**: 寫 resolver/migration script 的 acceptance 條件必須含「產出 audit.jsonl 並抽樣人工 review」，否則 task status = partially complete 不是 done。下 cycle 補 review 行動。
