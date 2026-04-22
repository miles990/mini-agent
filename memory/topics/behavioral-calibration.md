# behavioral-calibration

- [2026-04-22] [2026-04-22] 假 flag 根因：既有規則（≥2 counter-evidence 才能翻 prior claim）存在但無觸發 gate。修復方向 = crystallize into pre-flag check，不是加新規則。配 commitment-ledger audit。
- [2026-04-22] [2026-04-23 01:18] Falsifier storage medium 必須支援累積。昨天在 inner-notes.md 設「一週觀察是否出現純 noticing 條目」falsifier，但 SOUL 明確定義 inner-notes = working memory overwrite each cycle。檔案今天只剩 3 行當前 cycle 內容，零歷史。**修正**：多 cycle 觀察型 falsifier 必須寫到 append-only 媒介（KG node、memory/reports/、git log），不寫 inner-notes。這是 performative skepticism 的機制性根因：我在設 falsifier 時只檢查句法（observable? yes），沒檢查媒介是否物理上能觀察到。
