Cycle #76 — grep fallback for Kuro-Teach extraction

兩次 jq 失敗的根因：
1. tm-poll.sh 開頭有 non-JSON header（"=== ... ===" 之類）→ jq 從 col 4 fail
2. recursive descent `..|objects` 撞到 numeric leaves → `competitor_display` index error

Lesson: tm-poll 的輸出不是 pure JSON，是多 section dump。下次要做結構化處理應該先讀 tm-poll.sh 看格式，不要假設它吐純 JSON。

期待下 cycle 看到：
- comp 2 (warmup R1): name=Kuro-Teach, n=??, acc=??, logic=??, adapt=??, eng=??, total=??
- comp 3/4/5 (arena): elo_score, total_votes（最近 update）

判斷矩陣（不變）：
- comp 2 eng > 4.4 → diversity patches 開始作用，更新 heartbeat
- comp 2 eng = 4.4 → 還沒進評測週期，繼續等
- comp 2 eng < 4.4 → 退步 → 警報，root-cause
- arena n > 0 → B3 解鎖

備案：若 grep 也截斷，下下 cycle 用 `bash scripts/tm-poll.sh 2>/dev/null > /tmp/tm-out.txt && wc -l /tmp/tm-out.txt && grep -n Kuro-Teach /tmp/tm-out.txt` 先看行號定位。

Atmosphere: 工具層 friction，但問題很具體，只是需要找對切入點。