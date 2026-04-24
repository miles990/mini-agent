<!-- Auto-generated summary — 2026-04-24 -->
# context-optimization

Context 優化的核心在於「精準加載高信號 tokens」而非盲目壓縮，ACE 框架強調需防止簡潔偏見和 context collapse；具體上，Memory 瘦身和 mushi perception 壓縮 ROI 最高。關鍵洞察是 Prefix Caching 成本結構（cache write 1.25x 成本、任何 system prompt 變動會失效）意味著應改為「穩定 system prompt + 獨立可變 context 區塊」，避免變動 tier 的快取抵消效益。
