<!-- Auto-generated summary — 2026-04-30 -->
# buffer-pseudo-signal-warning

mini-agent 的「N cycles without action」警告是 recent-actions buffer 視角的偽訊號——buffer 邏輯只列最新 N 條 remember，導致已執行的 commitment（如多個 topic 檔案寫入、cycle 152 和 216 的報告）被遺漏而誤判為無行動。該問題根源於 buffer 設計本身不完整，下游需修正 commitment ledger 的自動關閉邏輯，以區分「buffer 不可見」vs「真的沒做」。
