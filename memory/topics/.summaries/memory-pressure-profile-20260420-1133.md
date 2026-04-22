<!-- Auto-generated summary — 2026-04-20 -->
# memory-pressure-profile-20260420-1133

系統記憶體瀕臨耗盡（可用 615MB、交換區 93.6% 滿），5 個 Haiku 子進程在同一分鐘生成共 1.22GB，懷疑存在內存洩漏導致 callClaude silent_exit。下一 cycle 將重新採樣判定是否為確實洩漏或正常耗盡，以決定是否需要啟動感知分析器快取遷移或子進程回收機制。
