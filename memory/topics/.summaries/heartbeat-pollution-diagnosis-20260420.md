<!-- Auto-generated summary — 2026-04-19 -->
# heartbeat-pollution-diagnosis-20260420

HEARTBEAT.md 遭 LLM 驅動的任務生成污染，根本原因是 htmlparser2 標籤洩漏 + addTask() 零驗證，允許格式碎片和垃圾字符直接寫入。提案通過四層防禦（內容驗證、速率限制、預驗證、監控）在解析器與儲存邊界攔截污染，7天內達到 < 200 行 + 零泄漏標籤為收斂條件。
