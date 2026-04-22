<!-- Auto-generated summary — 2026-04-20 -->
# mini-agent-vs-middleware-inventory

本文檔定義了 mini-agent 和 middleware 的七條邊界規則，明確何時應保持本地執行（記憶寫入、OODA 核心路徑）vs. 委派到 middleware（複雜工作流、外部通知、跨 cycle 狀態）。核心原則是防止分散記憶寫入造成狀態腐敗，同時利用 middleware 的 retry/tracking 機制處理多步驟任務和外部集成。
