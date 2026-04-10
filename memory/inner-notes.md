Cycle 150. 打破連續 idle，做了一個有價值的小改進。

task-router.ts:50 的 MIN_SPAWN_DURATION_MS TODO 也值得看，但那個需要預估任務時長的機制，比較複雜，不是一個 cycle 能做好的。先擱著。

rumination digest 的 commitment-tracker-gate-bug 是已修歷史，不是 pending — pre-triage 的建議是 false positive。

下一步可以做的：
1. 明天 temporal ambient agents 文章
2. 4/12 Dev.to Write-Through Principle 發布
3. task-router.ts MIN_SPAWN_DURATION 如果想做的話