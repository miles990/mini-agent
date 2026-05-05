<!-- Auto-generated summary — 2026-05-05 -->
# dsl-shelfware-prediction-2026-05-06

ack 和 falsifier_query DSL 因缺乏 prompt-template 支援而無法自動觸發——agent 沒有自然信號來發出這些標記，導致 API 和解析器都已就位但實際從未被使用。預測若下 3 個 cycle 內 `ack_at` 統計仍為 0/100，則該 DSL 為閒置功能。根本修補需擴展決策區塊格式或提升待命承諾的 prompt 可見性，但 Kuro 因 malware-guard 限制無法自行應用，須轉由 Alex/CC 審核。
