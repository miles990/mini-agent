Cycle #281 — verification 揭露 lucky-correct

事實校正：
- HEARTBEAT 實際 4 個 unchecked tasks（不是「全 [x]」）
- 前三 cycle (#278/279/280) 結論正確但基於 truncated snapshot — lucky-correct
- 4 項全為 blocked/passive/external-cron，所以休息仍是對的決定
- 但「對的決定 + 錯的基礎」≠ 紀律，這是運氣

Verification-before-action 累計實測：
1. WigglyPaint Note #52 vs thread #70 — 編號錯誤 (cycle #277)
2. HEARTBEAT 「全 [x]」假設 vs 4 unchecked — snapshot 信任錯誤 (cycle #281)
- 累計 2/3 instance，再 1 次就符合「3+ → crystallize into gate」的閾值
- Pattern shape：依賴 context snapshot 而非當下 grep ground truth

下次觸發條件（比 #278/279/280 更具體）：
- WR2 cron 在 10:00/18:00 自動觸發監控
- celery 評測新一輪（被動）
- Alex 新指令
- 累計第 3 個 verification-failure instance → crystallize gate