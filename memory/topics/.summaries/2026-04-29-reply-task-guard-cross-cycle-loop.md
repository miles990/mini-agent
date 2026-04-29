<!-- Auto-generated summary — 2026-04-29 -->
# 2026-04-29-reply-task-guard-cross-cycle-loop

此診斷檔案指出 reply-task guard 的 scope 過窄（只檢查同一 cycle），導致實際工作流（cycle N 回覆、cycle N+1 確認完成）中任務被重複 dispatch。推薦方案 A 是追蹤過去 3 個 cycle 的 chat emissions，保留安全意圖但符合實際工作流；若下一個 cycle 仍重複 dispatch，bug 根源應在 `markTaskDoneByDescription` 的 fuzzy-match 邏輯。
