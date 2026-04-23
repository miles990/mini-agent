<!-- Auto-generated summary — 2026-04-23 -->
# tm-calibration-log

此日誌記錄 TM 平台三次預測校準，核心教訓是：**命名與實質容易脫鉤**（AdaptabilityGate 實測 coherence）、**二元預測過脆弱**（「全空」被單一 entry 反駁），以及**應優先用 API 主資料判斷**（如 leaderboard config）而非推論。這些校準揭示預測失誤的系統性來源：概念混淆和 threshold 設置，而非基線理解錯誤。
