Cycle #49. 動作：tm-poll delegate 已派。

**Ghost commitments 3rd occurrence 確認**（#46 ack → #47 → #48 → 這 cycle 全部三條仍在）：
- 三條都指 skeptrune-tweet-opinion（#45 已 completed）
- perception layer 確認沒有「task completed → clear related untracked commitments」hook
- 這是 mechanism bug，候選修法：buildContext 掃 untracked-commitments 時比對 recent completed tasks 的 title/keyword，命中就跳過
- 觸發 three_attempts 門檻 = 下個 cycle 若 tm-poll 結果無驚喜，動手修這個 bug（code 路徑：buildContext.ts 的 commitment 抽取階段）

**12 unreviewed delegations**：全 EXPIRED，cycle #46 已批次 ack，系統沒清 = 另一個 mechanism bug（_shownCount 持久化可能沒涵蓋 EXPIRED 狀態）。先不動手，等 ghost commitments 修完一起看

**B3 監測節奏**：cycle #45 手動 curl（16:52）→ cycle #49 script poll。以後用 tm-poll.sh 為 canonical（feedback_cdp_playbook），不再重刻 curl