<!-- Auto-generated summary — 2026-04-27 -->
# 2026-04-28-view1-schema-falsification

Cycle #5 的設計文檔對 graph.json schema 的假設錯誤——node 沒有 `source` 欄位（只有 links 有），需從 `url` 推導來源——這導致之前的 scaffold 建立在不正確的基礎上。關鍵教訓是設計文檔在寫「現有結構能直接餵」前必須開檔 grep 驗證，而不能憑記憶，特別是多 repo workspace 環境下容易產生 path 飄。下個 cycle 需先寫 URL→source-of-origin classifier，驗證分布後再實作 View 1。
