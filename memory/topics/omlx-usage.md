---
related: [small-language-models, context-optimization]
---
# omlx-usage


**7 個使用點：**
1. 0.8B: Inbox 分類（RESPOND/SKIP, 3s timeout）— inbox-processor.ts:48
2. 0.8B: Memory Query 生成 — memory.ts:1397
3. 0.8B: Cron Gate（HEARTBEAT 任務判斷）— omlx-gate.ts:82-159
4. 9B: Working Memory 更新（Claude 沒寫 inner 時補寫）— cascade.ts:58-119
5. 9B: Learn 委派（3 turns, 5min timeout）— delegation.ts:121-128
6. 9B: Research 委派（5 turns, 8min timeout）— delegation.ts:121-128
7. mushi: Triage（wake/skip/quick, 3s timeout）— mushi-client.ts

**效能問題：**
- 0.8B cascade fallback rate 45%（主因 3s timeout）
- 2026-03-14 07:00-07:30 連續 6 次 timeout（疑似冷啟動）
- 成功時 avg ~840ms

**未啟用的優化：**
- Sonnet routing（model-router.ts 有實作但 feature flag 未開，500 cycles 全 Opus）
- Profile auto-routing
- Perception sections 86.8% waste ratio

**最高槓桿改善：** (1) 修 0.8B timeout（warmup/profile 調整）(2) 啟用 Sonnet routing
1. (cdecb42) timeout 修復：0.8B 3s→5s, 9B 5s→8s。根因：timeout 差 4-13ms 導致 48% fallback
2. (c6d5802) Sonnet routing bug fix：trigger reason 帶 metadata 但 routeModel 用 === 精確比對，改 startsWith。500 cycles 全走 Opus 的 bug 修了。加 cron/startup/delegation-complete 為 routine triggers
- **Layer 1 Classification**：擴展 mushi 從 skip/quick/wake 加 focused 檔，指定載入哪些 sections
- **Layer 2 Index**：topic entry-level relevance scoring（0.8B binary yes/no），不載整個 topic file
- **Layer 3 Cache**：context hash 比對，相同 trigger+context 6h 內 cache hit 跳過 Claude
- 預估加權平均省 ~78% tokens（routine 70% cycle 幾乎歸零）
- 關鍵約束：0.8B 只做 binary/classification（可靠），不做 summarization（不可靠）
- 實作順序：Cache → Classification → Index
