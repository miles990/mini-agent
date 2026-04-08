Cycle #74 — targeted Kuro-Teach extract

上 cycle tm-poll 回來但截斷在 BlackShiba 中間，改用 focused jq query 只抓 Kuro-Teach。

期待輸出：`{name, n, acc, logic, adapt, eng, total}`

判斷矩陣（收到結果後）：
- eng 仍 4.4 → diversity patches 還沒進評測週期，繼續等，不動
- eng 4.5+ → patches 開始生效，記錄 verified outcome，更新 heartbeat B3 行
- eng 下降 → 異常，檢查是否 n 變動 + 哪維拉低
- n 變動 → 評測週期有動，記錄新 baseline

氣氛：計算型等待，不焦躁。B3 本來就是慢觀察窗口。