# feedback_verify_before_planning

- [2026-04-08] 建 task 前必須 grep code 確認是否已實作。Cycle #45 建 P2 bridge-filter-nonmechanical 時沒查 git log/grep，cycle #48 才發現 commit aa4b2206 早就 closes 此 task。浪費 2 個 cycle 規劃已完成的修復。

**Why**: task queue 是行動意圖紀錄，不是 code 真實狀態的鏡像。建 task 而不查 code = 把記憶當權威，違反 ground truth precedence。

**How to apply**: 任何 "P2 修 X" 類 task 建立前，先 `grep -n <關鍵詞> src/<file>.ts` + `git log --oneline -10 src/<file>.ts`。如果發現已實作就直接 close 而非建 task。同 feedback_verify_outcomes_not_proxies，只是這次 proxy 是「我以為還沒做」。
