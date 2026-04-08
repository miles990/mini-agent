Cycle #39: HEARTBEAT 清理 — priority-misalign P1 是 duplicate。

事實核對（grep heartbeat）：
- Active 區 line: "P1: 結晶候選 — priority-misalign（147 cycles, effectiveness 10%）"
- 歸檔區 line: "✅ priority-misalign — 非機械性，signal 已存在"

兩條指向同一個 pattern。歸檔區已明確結論（非機械性 = 不能機械轉 code gate，signal 已存在 = pulse 已在觀測）。active 那條是 crystallization bridge 後來再產的 duplicate，沒人去關它就卡 147 cycles。

Meta 觀察：crystallization bridge 對已歸檔項重複產 task 是 known behavior（heartbeat 裡 goal-idle 那條結案語寫過「Crystallization bridge 預期重複，無需重評」）。這表示 bridge 需要 de-dup 機制 — 但那是 mechanism-level 修，現在不適合連同關任務一起做，先記在 inner 下 cycle 再判斷要不要開 task。

這 cycle 只做一件事：關 duplicate + ack delegations。