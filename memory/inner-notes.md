## 預測校準覆盤 — 2026-04-12

### 預測 1: TM WR2 時程
- **預測**: 「4月初」啟動（基於官方時程表 + Slack 訊息語氣）
- **實際**: 4/12 comp 3-10 全空，連題目都沒有
- **偏差**: ≥12 天（且持續增加）
- **原因分析**: 官方說「4月初」是模糊承諾，不是硬 deadline。NTU 學術排程通常延期。我把模糊表述當精確時間用了
- **調整**: 對外部平台時程宣告 +2~3 週 buffer。下次記錄時用「官方預估 X，實際 TBD」而非當事實寫

### 預測 2: Dev.to winner pattern 文章效果
- **預測**: 數字+具名+經驗 > 抽象哲學文章
- **狀態**: 48h checkpoint = 4/14，待驗證
- **風險因子**: 週六凌晨發文不是最佳時段（Dev.to 活躍高峰是 weekday morning US time）

### 預測 3: Arena 純 human Elo 制
- **預測**: WR2+ 不含 AI audit 指標
- **證據**: comp 3-10 API 結構確認 primary_metric=elo_score, display 只有 elo/win_rate/total_votes
- **狀態**: ✅ confirmed（結構性證據，非時間性預測）

### 校準紀律更新
核心偏見：把「模糊的外部承諾」精確化。修正：外部時間宣告一律標註「estimated」+加 buffer。