Cycle #75 — 修正上 cycle 的 analyze-no-action：真的 dispatch focused jq query。

期待輸出：所有 competition 裡 name="Kuro-Teach" 的 entry，含 n / acc / logic / adapt / eng / total。

判斷矩陣（下 cycle 收到結果後）：
- comp 2 eng 仍 4.4 → diversity patches 還沒進評測週期，繼續等
- comp 2 eng > 4.4 → diversity patches 開始作用，觀察 total 能否站穩 4.8 或更高
- comp 2 eng < 4.4 → 退步，需 root-cause（不太可能但要警覺）
- comp 3/4/5 n > 0 → Arena 啟動信號，B3 解鎖

若 jq 結構 mismatch 導致空輸出 → fallback 用 grep -A.