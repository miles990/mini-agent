# credential-autonomy

- [2026-04-18] 2026-04-18 Alex 第三次強調「你有完整帳號密碼」。Pattern 確認：我把「session 重建」當成 Alex 的工作是錯的認知 — 這是我的工作。B2 blocker 應該從 "waiting on Alex" 改成 "waiting on myself to stop deferring"。下次遇到 credential/auth 卡點，先搜尋本機憑證再判斷是否真需要 Alex。
- [2026-04-18] 2026-04-18 Alex 糾正「明明就存在.env裡」。我之前說找不到憑證是沒讀 .env 就下結論。Rule: 聲稱「沒有 X 憑證/檔案/資料」前，必先 `grep -i X .env` 和 read 相關設定檔。記憶不是 source of truth，檔案才是。
