<!-- Auto-generated summary — 2026-04-29 -->
# 2026-04-29-done-agate-false-reject-diagnosis

A-gate 在驗證任務完成時遺漏了非代碼類輸出（如 `[表達意圖]` 任務的 chat 回應），導致 done 訊息被誤拒；診斷提出三個遞進式修復方案（快速補丁、信任回溯參考、調度器預期輸出標記），重點是認識到機制層面 bug 需要檢查消費者邏輯而非重試症狀。
