<!-- Auto-generated summary — 2026-04-30 -->
# 2026-04-30-scheduler-double-dispatch-bug

調度器雙分發 bug 的根本原因已精化：Bug 1 來自 `updateMemoryIndexEntry` 的去重缺失（1.8% 快速重複），Bug 2 來自記憶查詢失敗導致任務無法轉移終端狀態。先前的修復建議需要重寫，特別是 Fix C 是基於不存在的 49 分鐘旋鈕提出的。關鍵學習：驗證檔案存在不等於驗證檔案內容的聲稱。
