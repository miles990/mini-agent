---
related: [product-thinking, alex-preferences]
---
# defi-automation

四階段計劃：
- Phase 1（第 1-2 週）：零成本監控基礎設施 — WebSocket 連 Arbitrum/Base，監聽 DEX 價差/大戶動向/清算事件，數據寫 JSONL
- Phase 2（第 2-3 週）：穩定收益 — Beefy/Yearn vault，模擬交易先行
- Phase 3（第 4+ 週）：Flash Loan 套利（L2，不需本金）
- Phase 4：策略組合+自動再平衡

風險控管硬規則：
1. Phase 1 純監控零風險
2. Phase 2 前跑 2 週模擬
3. 資金操作有 hard cap + 停損
4. 全部操作有 audit trail
