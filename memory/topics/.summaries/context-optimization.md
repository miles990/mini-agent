<!-- Auto-generated summary — 2026-04-16 -->
# context-optimization

Context optimization 的核心是在 recall 質量和 tokens 之間找平衡——Anthropic 指南倡議精準載入高信號 tokens，ACE 框架警告反覆優化會丟失域知識細節。實務發現 prefix caching 成本高昂，動態改變 system prompt tier 會破壞 cache 效率，改進策略應改為穩定系統提示加獨立可變 context 區塊。token 優化優先級：Memory 瘦身（一次性永久省）> mushi perception 壓縮（複利最高）> cycle prompt 精簡。
