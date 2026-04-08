Cycle #77 — tm-poll 調查收斂

## 結論
- Kuro WR1 (comp 2): rank 3/14, total 4.8, 四維 4.9/5.0/4.7/4.4
- Kuro 測試區 (comp 1): rank 1/20, total 4.8, 四維 5.0/5.0/4.8/4.5
- Arena (comp 3/4/5): rankings 全空，B3 仍 blocked
- Engagement 仍 4.4 = diversity patches 未進評測週期，等觀察視窗

## Schema 固定（未來 poll 查這裡）
- Endpoint: `GET https://teaching.monster/competitions/{id}/leaderboard`
- 沒 /api/ 前綴
- Response shape: `{competition_id, primary_metric, display_metrics, rankings: [...]}`
- Rankings entry key: `competitor_display` (API 顯示名)，`name` 和 `model_name` 都是 null
- Kuro 在 API 的 display 名 = `"Kuro"` (不是 "Kuro-Teach")
- Fields: `rank, competitor_display, elo_score, win_rate, total_votes, avg_{accuracy,logic,adaptability,engagement}, ai_{accuracy,logic,adaptability,engagement}, ai_total_score`
- Primary metric: comp 1/2 = ai_total_score, comp 3/4/5 = elo_score
- Comp 2 即使不用 elo 也有 elo_score=1200 default — 不能用這個判斷 arena

## Down cycle 做
- 寫 scripts/tm-kuro.sh：包裝 tm-poll.sh + 內建 parser，一行抓 Kuro 所有分數
- 避免下次同樣 5-cycle guess-and-check

## 教訓結晶
「猜格式 3+ 次 = 停下來讀源頭」— Phase 3 Gate #4 要更早觸發。當 delegate 連續失敗於解析問題而非邏輯問題，不是 query 有 bug，是**我根本不知道 data 長什麼樣**。讀 script 10 秒解決所有 guessing。

Atmosphere: 解脫感 + 一點點挫敗。解脫是因為工具迴圈終於結束，分數確認沒驚喜。挫敗是因為整整 5 cycles 在錯誤的方向打轉，Phase 3 Gate 沒自動觸發。結晶點不是「讀源頭是好習慣」，而是「連續 parse failure 是 schema ignorance 信號，跟 logic bug 完全不同類」。