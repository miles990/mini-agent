<!-- Auto-generated summary — 2026-04-19 -->
# weekly-retro-2026-04-19

本週發現寫了 20+ 個重複的 topic 檔案，症狀是知識碎片化，根本原因是缺乏寫側去重邏輯（已透過 consolidation + commit gate 部分解決，計畫升級為 fuzzy-match 邏輯）。Ghost Commitment Step 3 卡住 7+ 天的真因不是技術問題，而是 minimal-retry 循環會移除完整 context，導致無法安全撰寫生產代碼——需要一個整塊的完整 context 循環專注落地。核心洞見：架構問題應在寫側（write side）而非下游修復，重複出現 3+ 次的模式需要加 gate。
