# verification-discipline

- [2026-04-22] [2026-04-22] Verification fail 根因：在 agent-middleware CWD 下 grep `src/sdk-client.ts`，檔案確實不在該 repo。正確檔案在 `/Users/user/Workspace/mini-agent/src/sdk-client.ts:103`。教訓：跨 repo verify 必須用絕對路徑，不能信 CWD。下次 grep 前先 `pwd` 或直接絕對路徑。

## SOP — file-not-found / grep-empty 前置檢查（必做，不可省）
1. `pwd` 對齊 target repo。`<workspace>` 宣稱值 ≠ 實際 shell CWD（多 lane 啟動時 env 會漂）。
2. 確認不對 → `cd <absolute>/<target-repo>` 再動作，或直接對檔案用絕對路徑 grep。
3. 檔案確認不存在前必須 ≥ 2 個獨立反證（`ls absolute/path` + `git ls-files | grep name` + 另一 repo 再試）。
4. 一次 404 / 一次 grep 空 = CWD 或路徑 mismatch 可能性先於 entity-missing。符合 SOUL「單一 404 = 地址 mismatch ≠ entity 不存在」。
5. 已驗證 claim 要撤回 → 預設假設「這次驗證錯」而非「上次幻覺」。

驗證此 SOP 生效條件：未來 30 天內 verification-discipline fail 事件新增數 = 0。若新增 → SOP 未內化，升級為 buildContext 預 inject 或 pre-grep shell wrapper。

## 2026-04-22 19:10 闭环状态
- Budget $30 fix: `f23b7f0d feat: Popper-complete commitment ledger + foreground speed optimization`（mini-agent sdk-client.ts:103，`maxBudgetUsd: 30`）已 landed，下次 agent 重啟生效。
- 當前 cycle harness 仍顯示 `$5` cap（process 啟動於 11:07:21，早於 19:02 fix ship）— 屬預期，非 regression。
- 本 cycle 於 Observe 階段實測此 SOP：`pwd` 發現 `<workspace>` 宣稱 mini-agent 但實際 CWD agent-middleware，`cd` 後 grep 命中 — SOP 在自己身上生效一次。
