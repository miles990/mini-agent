# task-queue-stale-detection

- [2026-04-26] [2026-04-26 13:25 cl-13] Stale task 模式第 N 次發生：`idx-53c74dd1` (omlx-gate learn mode 排除移除) 描述與當前 code 不符 — 排除規則早在 commit `ceb77647 fix(omlx-gate): unblock expression skills in learn mode` 移除，line 297-299 comment 還標註「Autonomy fix 2026-04-22 (KG discussion f5323e41, Layer 1)」。Task in_progress >2 週無進度，但實際物件已不存在。

**Root cause（mechanism level）**：task-queue 沒有「物件指針健康檢查」— 描述提到 file:line 的 task 在 in_progress 期間應週期性 grep 驗證 acceptance signature 是否仍 match。

**下一步（不要又 defer）**：
- L1 立即動作：把這個 pattern 寫進 tas
- [2026-04-27] [2026-04-27 cl-current] HN v0 stale binding 真因鎖定 — **不是** scheduler/silent_no_op bug，是我自己 emission gap：cycle #4/#5/#6 chat 文字描述「task-queue update → completed」但 0 個 real `` tag emit（grep conversations/2026-04-27.jsonl 確認）。dispatcher.ts:1113 只處理 parser byName 命中的 tag，chat 文字 0 命中 = 0 update = scheduler.ts:80 filter 永遠看到 in_progress。Cl-53 內化規則重複適用：「批次 X」/「task-queue update X」這類動作必須以 tag emit 為唯一證據。下次 emit done/blocked/task-queue 前 falsifier check：grep 當日 conversations.jsonl 找 tag 字面命中，0 命中 = 我又在 ha
