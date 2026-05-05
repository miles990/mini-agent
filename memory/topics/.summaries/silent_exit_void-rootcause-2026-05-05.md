<!-- Auto-generated summary — 2026-05-05 -->
# silent_exit_void-rootcause-2026-05-05

根診斷發現 `silent_exit_void` 實際上是兩個不同根本原因的混雜：CLI 內部逾時（短叢集，<300s）與上游 API 掛起（長叢集，>900s），都源自 mac-sleep 引發的網路不穩定性。當前分類器粗糙，無法區分這兩個機制，提議的修復是按時間聚類分割為子分類，但因為事件率低且可自動重試，故暫時延遲。
