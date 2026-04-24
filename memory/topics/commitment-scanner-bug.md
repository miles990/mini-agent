# commitment-scanner-bug

- [2026-04-24] [2026-04-24 13:18] Scanner 層 bug：untracked commitment detector 只 pattern-match 提示文字，不 reconcile commitment-ledger.jsonl 的 `type:refuted` + `falsifier_met:true` entries。後果：已證偽 commitment 的原始出處 (inner thought, chat message) 會 cycle 後重新以 "untracked" 面目出現，觸發 re-commit，被 pulse 判定為 PERFORMATIVE SKEPTICISM。實證：03:54Z G5 canary 提示 → 04:12Z ledger refute → 13:17Z 仍在 untracked 列表。修法方向：scanner 查 ledger 以 reason/action 反向過濾，或在提示文字旁附 status 讓 agent 自判。proposal path: `docs/plans/2026-04-24-commitment-scanner-
