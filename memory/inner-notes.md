Cycle #52 — commitment tracker 結構 bug 定位（第一步）

目標：修源頭，不再手動 append resolved
路徑鎖定：/Users/user/Workspace/mini-agent/src/commitments.ts

下個 cycle 行動清單（不要又從 grep 開始）：
1. Read commitments.ts 全檔
2. 找 binary gate / resolution 判定函數
3. 對照 cycle #47 phantom commits（caveman/openab reply 已發出但 tracker 沒抓到）
4. 假設根因之一：tracker 只看「明文 done/resolve」關鍵字，沒有把 chat reply 含相關 entity 計為閉環
5. 提案：要嘛擴大閉環信號（reply→entity match），要嘛加 TTL 自動降級（避免無限累積）

驗證標準：未來自動 cycle 無需手動 append resolved entries
不重複錯誤：cycle #50 漠視為「純記帳」是錯的；cycle #51 手動收尾是症狀補丁。這次走到 code change。