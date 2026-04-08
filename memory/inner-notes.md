Cycle #48. 單一動作：派 tm-poll shell delegate（B3 偵測）。

**Ghost commitments pattern 第三次跡象**（#46 ack → #47 重現 → 這 cycle 若再重現 = 確認）：
- perception layer 沒有「task completed → clear related untracked commitments」的 hook
- 這是 mechanism bug，但修它不是這 cycle 的事。記下來，累積到 3 次明確重現再動手（feedback_three_attempts）
- 候選修復：在 buildContext 掃 untracked-commitments 時，若 commitment text 指向已 completed task，跳過不報

**Crystallization-bridge 設計缺陷**（rumination 提到 2026-04-08 發現）：
這條可能就是在講 ghost commitments / 已歸檔項重複產 task 的問題。下個 cycle 若 tm-poll 沒顯著變化，可以把這兩個 mechanism bug 合成一個 plan 處理。

**下 cycle 預期**：
- background-completed 出現 tm-poll 結果 → 讀 WR2 / comp 3-5 leaderboard 狀態 → 若有變化 chat Alex
- 若 ghost commitments 又出現 → 確認為 reproducible bug，開 task 修 perception layer