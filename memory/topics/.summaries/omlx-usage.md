<!-- Auto-generated summary — 2026-04-16 -->
# omlx-usage

OMLX-usage 是一個多模型推理系統，用 0.8B、9B 和 mushi 模型分別處理 inbox 分類、記憶查詢、cron gate 等 7 類任務，但目前面臨 0.8B cascade fallback rate 高達 45% 的問題（主因 3 秒 timeout 過短）。最高槓桿的改善是調整 timeout 設定（0.8B 3s→5s、9B 5s→8s）和啟用 Sonnet routing bug fix，並通過三層優化策略（快取→分類→索引）可預期節省約 78% tokens。
