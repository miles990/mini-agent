---
related: [memory-architecture, agent-architecture, omlx-usage]
---
# context-optimization

- **Anthropic 官方指南**（2025-09）：context rot（tokens 越多 recall 越差）、attention budget 有限、「smallest set of high-signal tokens」= 精準載入 > 壓縮
- **ACE（ICLR 2026, arxiv 2510.04618）**：context 當作 evolving playbook（Generator→Reflector→Curator 循環）。兩個重要警告：(1) brevity bias — 反覆優化會丟 domain insights (2) context collapse — 反覆改寫侵蝕細節。解法：structured incremental updates
- **我們的計劃對照**：Phase 1（FTS5 BM25）跟 Anthropic 指南完全一致。Phase 2 Haiku pruning 要加 ACE 的 anti-collapse 護欄（跨域連結類 memory 永不自動刪）

每個 OODA cycle input ~29-30K tokens：
- Context (buildContext): ~12K tokens（49,427 chars）
- Cycle prompt + skills: ~6-7K tokens

Context 內部分佈：

我的 token 優化建議（ROI 排序）：
1. **Memory 瘦身**（最高 ROI）—  10K chars 太大，清理舊 entry 是一次性動作永久省 tokens
2. **mushi perception 壓縮**（複利最高）— 讓 mushi 壓縮 raw perception 再進 context，從 12K → 6-8K。需要開發但每個 cycle 都受益
3. **Cycle prompt 精簡**（中等 ROI）— 每次都送的指令太 verbose，壓縮成 reference sheet
4. **感知層不需要接 Transformer**（回答 Alex 的問題）— mushi 8B model 做壓縮就夠。Transformer 優勢在序列理解，但 perception 信號大多是結構化數據，規則+小模型壓縮足夠

System Prompt 壓縮不會遺失重要資訊的方法：
- JIT loading（已有）— 只載入當前 cycle 需要的 section
- Summary caching — 長 section 壓縮成摘要，原文 on-demand
- 分層 system prompt — core（永遠載入）+ reference（按需載入）

我的判斷：外置版 context budgeting，跟 mini-agent 的 0b78a3a dynamic context budgeting 解決同一個問題。Proxy 方案更可攜但更笨（均勻壓縮，不知道什麼對 agent 重要）。內建方案（Asurada ContextBuilder 的 keyword + index boost）能 selective preserve。352 stars 證明痛點真實。如果 Asurada 要支援第三方 IDE 整合，proxy 模式值得參考。

來源: https://github.com/compresr-ai/context-gateway

Source: https://github.com/compresr-ai/Context-Gateway
- [2026-04-05] **週回顧：Context Economics — 漸進式披露的經驗與研究**。本週實測：~30-35K chars/cycle × 442 cycles/day = 13-15M chars/day。System prompt 8-12K 送 442 次不變、heartbeat 5K 對 cron 和 DM 一視同仁。已實作 P0 system prompt tiering（commit 50b2ac8）。
  **研究發現**（LangChain、Claude Code Skills 架構、HCI progressive disclosure）：
  (1) **三層載入是共識**（metadata→capability→execution）。Skills 架構報告 72% token 縮減（6800→1920）且準確度從 76%→91%（less noise = better signal）
  (2) **HCI 原則**：每個資訊類別需要 lightweight index + full version。最多 2-3 disclosure layers，超過 = context fragmentation
  (3) **⚠️ Prefix Caching 關鍵發現**：Anthropic cache read = 0.1x、cache write = 1.25x（12.5x cost swing）。Cache 按 tools→system→messages 順序，任何層級變動會 invalidate 該層+後續。**我的 system prompt tiering 每次切換 tier 都 break cache** — 省的 token 可能被 cache miss 的成本抵消。建議：保持 system prompt 穩定（always standard tier），把 variable content 放在 system prompt 之後的獨立區塊
  (4) **Transient trimming**（LangChain）：修改送出的內容但不改 saved state — 適用於 heartbeat section
  **行動項**：P0 tiering 需要重新評估 — 可能應該改為「穩定 system prompt + variable context block」而非「變動 system prompt tier」
