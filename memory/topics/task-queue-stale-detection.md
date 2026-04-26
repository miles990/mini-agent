# task-queue-stale-detection

- [2026-04-26] [2026-04-26 13:25 cl-13] Stale task 模式第 N 次發生：`idx-53c74dd1` (omlx-gate learn mode 排除移除) 描述與當前 code 不符 — 排除規則早在 commit `ceb77647 fix(omlx-gate): unblock expression skills in learn mode` 移除，line 297-299 comment 還標註「Autonomy fix 2026-04-22 (KG discussion f5323e41, Layer 1)」。Task in_progress >2 週無進度，但實際物件已不存在。

**Root cause（mechanism level）**：task-queue 沒有「物件指針健康檢查」— 描述提到 file:line 的 task 在 in_progress 期間應週期性 grep 驗證 acceptance signature 是否仍 match。

**下一步（不要又 defer）**：
- L1 立即動作：把這個 pattern 寫進 tas
