# crystallization-bridge-design

- [2026-04-08] **Crystallization bridge 設計缺陷**（2026-04-08 發現）：

bridge 為所有 pulse signal 累積 cycle count，但 pulse 在 alex mode（pulse.ts L824-828）已 filter 掉三類 signal：
- `priority-misalign`
- `goal-idle`  
- `stale-tasks`

這些 signal 不會傳給 LLM、不會影響行為，但 bridge 仍計數，產生 phantom 結晶候選。

**Why**：filtered signals 沒有「行為上的不變」可以結晶 — 它們對行為已經是 0 影響，再寫 hard gate 是雙重否定。

**How to apply**：crystallization bridge 應在計數前先檢查 signal type 是否在 alex-mode filter list。修這條 bug 後可避免未來把 filtered signals 列為結晶候選。

證據：priority-misalign 跑了 147 cycles 才被識破是 phantom（這個 cycle）。
