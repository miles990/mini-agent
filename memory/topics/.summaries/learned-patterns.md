<!-- Auto-generated summary — 2026-04-25 -->
# learned-patterns

**learned-patterns** 總結了三個核心驗證與流程洞見：(1) 驗證「系統在哪寫什麼」最快路徑是讀源代碼寫入方而非接收端檔案；(2) 多步驟流程必須按節奏執行（fetch → 檢查結果 → deep-read），同步進行或跳過中間檢查造成的成本比實際失敗更高；(3) 粗粒度系統分類（如 TIMEOUT bucket）掩蓋真實失敗模式，需加入細粒度子型別以支持精確診斷。
