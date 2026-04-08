Cycle #42 完成：HEARTBEAT Active Tasks 區三條 closed P1 歸檔 + commit ed0ff30e + push。

做了什麼：
1. Read HEARTBEAT 確認三條 [x] P1 (priority-misalign/goal-idle/skill-creation-nudge) 都仍在 Active Tasks 區（位置：line 27-29）
2. Edit 整批替換成單一歸檔 comment，第一句寫「歸檔規則：crystallization bridge 任務 close 後立刻移到此 comment 區」當未來提示
3. Commit ed0ff30e + push origin/main

驗證：git status 乾淨、push 成功（7d86d9fb..ed0ff30e）。

Meta：這是 reasoning continuity 的延伸 — cycle #39/40 處理了 priority-misalign 一條的 close，cycle #41 處理 rumination stale entry，cycle #42 把同類型的另外兩條和已 close 那條一起歸檔到位。三個 cycle 的鏈路 = 一個 mechanism-level fix（不是修單條，是把「Active Tasks 累積 closed item」這個 content-rot 模式處理掉）。

下個 cycle 的 perception 不會再看到那三條了 — 真正的 outcome 驗證會在下一輪 prompt-builder 跑完時自然出現。

不需要新的 todo list — single-action cycle，已 commit + push 閉環。