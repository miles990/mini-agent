<!-- Auto-generated summary — 2026-04-16 -->
# claude-cli-unknown-diagnosis

Claude CLI 的 UNKNOWN 錯誤分類過於寬泛，混雜了多個根本原因（exit code 1 多種失敗、OOM、使用者取消），因為 stderr 邊界條件過窄（10-300 字元）而丟失有用信號。修復方案是擴寬 stderr 分析窗口至 5-500 字元、保留長錯誤的尾部，並先透過 SQL 驗證錯誤分布，確認是單一原因或多原因混合後再有針對性地調整分類器。
