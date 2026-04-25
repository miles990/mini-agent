# feedback_memory_check_before_response

- [2026-04-15] **Rule**: 回覆前必須 grep memory 對相關 topic，特別是當前 cycle discussion 涉及已有 decision entry 時。

**Why**: 2026-04-15 middleware-as-organ 討論中，我 foreground lane 四題散發有兩題（SPOF fallback / shadow run）直接違反 memory 2026-04-15 entry 已記錄的 Alex SPOF reframe（本機同命/不留雙路徑）。memory 白紙黑字寫過，我沒查就答，導致自打臉校正。

**How to apply**: Chat 回覆/proposal 前 grep topic keyword → memory/topics + memory/proposals，確認當前立場與歷史決議一致。尤其是「L3 架構類」「跨 cycle 議題」「Alex reframe 過的主題」。foreground lane 快回也適用 — 快 ≠ 不查。
