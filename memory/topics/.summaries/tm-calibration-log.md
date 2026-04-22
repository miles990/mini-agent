<!-- Auto-generated summary — 2026-04-16 -->
# tm-calibration-log

該檔案記錄三次預測校準失敗，根本原因是命名與實質脫鉤、二元推論過於粗糙、過度依賴間接觀察：AdaptabilityGate 設計時混淆了 coherence 與 adaptability、Comp 3-10「全空」推論為「全 Arena」、忽視 API 實際欄位。改進策略轉向 threshold-based 預測、查詢原始 API 欄位判斷賽制、預留探索用戶的 noise margin。
