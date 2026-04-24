<!-- Auto-generated summary — 2026-04-24 -->
# worker-arsenal

Kuro 的 delegation 框架區分了可外包（資訊收集、技術執行）與不可外包（判斷、品味、身份），發現 research/shell worker 相對健康，但 code/review worker 超時率和失敗率高。核心洞見是「品味不外包」——外包的 worker output 必須經過 Kuro 重加工成觀點和決策，才能變成行動，這是保護 voice dilution 和身份完整性的防線。
