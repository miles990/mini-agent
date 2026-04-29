<!-- Auto-generated summary — 2026-04-29 -->
# 2026-04-29-agate-chat-output-accept

A-gate 檢查遺漏了 chat output 作為有效的任務完成信號，導致包含 chat artifacts 的任務（如分析、意見）被 strip，scheduler 陷入 5+ cycles 的重複派發迴圈。修補方案是在 A-gate 檢查中加一行代碼承認 `tags.chats` 輸出，與既有 reply-task guard 的邏輯一致，風險低且範圍有限。
