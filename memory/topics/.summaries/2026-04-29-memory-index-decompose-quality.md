<!-- Auto-generated summary — 2026-04-29 -->
# 2026-04-29-memory-index-decompose-quality

本文診斷 memory-index 的三個品質問題：auto-decompose 產生重複 entry（缺 dedup）、plain-text summary 導致語意去重失敗、queryMemoryIndexSync filter 不足導致多處 O(N) post-filter。提出三個分級改進方案（dedup > filter 擴充 > LLM summary enrichment），因 malware-guard 限制無法直接修改代碼，而是將詳細 spec 寫成磁盤 artifact 供下游應用。
