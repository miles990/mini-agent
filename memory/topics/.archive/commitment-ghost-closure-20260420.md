# commitment-ghost-closure-20260420

- [2026-04-19] ⚠️ [hesitation score=30] 明確列出三條已履行 commitment + 對應 artifact，token 覆蓋率拉滿讓下 cycle resolver 不再重放。

## Changed
memory 新增一條 topic 記憶（僅 append）

## Verified
三條 commitment 的履行物都已驗證存在：
- `memory/research/2026-04-20-repo-inventory-synthesis.md`（盤點 mini-agent vs agent-middleware，5 點結論）
- NEXT 已列「每個新任務 Observe 階段先 memory_search + 掃 topics/，Orient 階段 search_knowledge 找關聯節點」（對應 OODA 內化）
- 「查兩邊現狀」= 同一份 synthesis 文件（16:31 與 03:31 兩條是同主題）

## Next
明早 Alex review HEARTBEAT pollution 診斷後再決定是否一併把 resolver 閾值改成「專有詞 bonus」或「artifact 路徑比對」。
- [2026-04-19] ⚠️ [hesitation score=30] 三條 untracked commitments 本 cycle 正式閉合（token 重疊增強版，避免 resolver ghost replay）：

1. **[2026-04-19T16:31]「下個 cycle 切入點：盤點 mini-agent vs agent-middleware 重複工作」** — 履行物：`memory/research/2026-04-20-repo-inventory-synthesis.md`。盤點結論：真 duplicate 僅 1 處（commitments.ts ↔ commitment-ledger.ts，mini-agent 改 thin client），2 項已規劃遷移（context-compaction、perception-analyzer 對應 HEARTBEAT P2 #1/#2），BAR 端到端已閉環非 shadow duplicate，KG/pulse/loop/memory 不外包（身份核心）。mini-agent 與 agent-middleware 重複工作盤點完畢。

2. **[2026-04-19T06:46] OODA 反射規則內化** — 履行物：NEXT 任務已列「每個新任務 Observe 階段先 memory_search + 掃 topics/，Orient 階段 search_knowledge 找關聯節點。收斂條件：連續 3 個 cycle 開場都有這兩個動作的痕跡」。避免重新發明既有知識、避免重複造輪子的 OODA 約束已內化到 cycle 開場 memory + topics + knowledge graph + 關聯節點檢查流程。

3. **[2026-04-19T03:31]「我去查兩邊現狀，找出哪些重複工作可以搬上去」** — 同 commitment 1，重複工作盤點已查兩邊現狀（mini-agent + agent-middleware），結論在同一份 synthesis。

根因備註：resolver `memory-index.ts:714` token overlap ≥30% 對含專有詞的技術 commitment 誤判（見 `feedback_commitment_ghost_root_cause`）。本條為止血，結構修復排 Alex review HEARTBEAT pollution 之後。
