<!-- Auto-generated summary — 2026-04-16 -->
# kg-conflict-audit-2026-04-17

本稽核發現知識圖衝突解決中約 30% 的漂移，源於不相容的分類規則（conflicts.jsonl 用 R1–R5+MISC vs audit.jsonl 用 R1–R8）及薄弱的推理，特別是 6 項衝突類型使用模板化證據，錯誤地將原則分類為決策。在 23 個實體中，57% 的判斷明確正確，但 HEARTBEAT 和 .ts 檔案等 2–3 個高價值實體被誤分為單一類型，應為多類型，需統一規則並補強實體級推理。
