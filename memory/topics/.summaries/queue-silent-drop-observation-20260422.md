<!-- Auto-generated summary — 2026-04-22 -->
# queue-silent-drop-observation-20260422

隊列檢測到選擇性無聲丟棄：前個 cycle 發出的 2 個任務標籤在後續 cycle 的隊列中消失，而其他舊項目仍存在，暗示在解析或驗證層有特定的拒絕點。最可能的原因是合法的任務字符串被新增的驗證門檯（heartbeat-pollution fix）拒絕但未記錄。目前僅觀察 1 次事件，決定等第二次出現確認為模式後再診斷修復，避免過度儀表化。
