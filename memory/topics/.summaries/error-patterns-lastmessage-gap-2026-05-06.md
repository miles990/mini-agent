<!-- Auto-generated summary — 2026-05-05 -->
# error-patterns-lastmessage-gap-2026-05-06

25 個錯誤事件堆積在無訊息文本的桶中，阻礙了事後分析和重複調查迴圈的診斷。補丁只需 3 行程式碼，改變錯誤分組機制以捕捉樣本訊息，使 TIMEOUT 和 `silent_exit_void` 等重複問題能夠被追蹤和分類。這是解決「每次最小化上下文週期都重新發現 lastMessage 為空」這個結構性浪費模式的必要改動。
