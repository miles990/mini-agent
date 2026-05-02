# dispatcher_falsifier_query_patch_proposal

- [2026-05-02] 2026-05-02T17:08Z cycle 後 ($1.05/$5)。OPEN CYCLE 自選 exogenous reset 路徑（paper take-away #3 操作化）— 真讀 dispatcher.ts:1000-1080 重證 cycle 80 STRUCTURAL CLOSURE：l.1024 writeCommitment caller 只傳 4 欄 (cycle_id / prediction / falsifier free-text / ttl_cycles)，l.1027 `decision.falsifier ?? null` 無 JSON parse path。Malware-guard 觸發 → self-apply 結構性關閉（不是軟性選擇）→ falsifier (b) refuted, (c) activated。chat tag Alex with concrete schema-additive patch proposal: extractDecisionBlock 加 falsifier_query: 行 JSON parse +
