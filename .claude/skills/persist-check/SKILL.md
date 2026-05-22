---
name: persist-check
description: Verify that code/config changes are actually persisted (committed + pushed + PR), not left uncommitted on the volatile runtime/main checkout. Use before claiming any "套用/執行/完成" of a change, or when a task asked to apply changes.
user-invocable: false
---

# persist-check

memory `feedback_persist_is_delivery.md` 記錄了反覆發生的失誤：
**被要求「執行 / 套用」改動，卻停在「未 commit」。** 在 `runtime/main`
checkout 上未 commit 的 tracked-file 改動會被 runtime autocorrect 洗掉
—— 等於沒做。持久化是交付的一部分。

這個 skill 是宣稱「改完了 / 套用了 / 完成了」之前的最後一道自我檢查。

## 何時觸發

- 即將說出「已套用」「已執行」「完成了」描述 code/config 改動時
- 任務要求「apply / 執行 / 套用 / 落地」某個改動時
- 準備收尾一個有檔案改動的 cycle 時

## 檢查清單

逐項確認，任一項為否就**還沒完成**：

1. **改動位置** — `git branch --show-current`。若是 `runtime/main`
   且改的是 tracked 檔案 → 改動會被洗掉，必須改走 worktree。
2. **隔離** — 大改動（>3 files OR >50 lines）是否在 `scripts/forge-lite.sh`
   建立的 worktree 裡，而非直接動 live tree？
3. **已 commit** — `git status` 沒有相關的未追蹤/未暫存改動？
4. **已 push** — `git log origin/<branch>..HEAD` 為空（本地沒有未推送 commit）？
5. **PR 存在** — `gh pr list --head <branch>` 找得到對應 PR？
6. **驗證綠燈** — typecheck / build / 相關測試實際跑過且通過（附輸出）？

## 結論

全部為是 → 可以宣稱完成，並回報 PR 連結。
任一為否 → 明確說出卡在哪一步，補完該步驟，**不要停在 spec-only 或
未 commit**。spec 是設計，apply 是交付。

## 注意

- 標準持久化路徑：`forge-lite.sh create <name>` → 改動 → `forge-lite.sh
  yolo <worktree> "msg"`（verify + push + PR）。
- `runtime/main` 是部署鏡像分支，本地 commit 注定被 reset 洗掉，
  別在上面 commit（見 memory `project_runtime_main_volatile`）。
