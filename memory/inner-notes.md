## Cycle #65 — ghost-commitments-bug fully closed

**What changed this cycle**: Single JSONL append resolved `idx-3cd55124 "## 我會做的"` (the lone surviving ghost from 11:18:51). Verified: latest entry for that id now has `status=resolved`. mtime on relations.jsonl changed → running api.js pid 72478 will reload cache on next query.

**Three-layer closure confirmed**:
- L1 symptom (displayed ghost): resolved this cycle
- L2 mechanism (extractor accepted `^#{1,6}\s`): fixed by 1a0cbf1d, built 21:37, server restarted 21:37:20 — **deployed before any of the last few cycles ran** but data remnant needed manual cleanup
- L3 meta (cycle #59/#60/#61 inner-notes never emitted tags): already captured in `feedback_actions_over_words` memory

**Audit finding**: 7/8 commitments from 2026-04-08 that were still in TTL had already been resolved organically via `resolveActiveCommitments` token-match — last resolve 09:25:45. The ghost was stuck specifically because its 3 bigrams (`我會`, `會做`, `做的`) happened to miss every response OR because the cycles that could have matched were also extracting it fresh (pre-fix). Fix closes both sides.

**Next cycle validation**: on heartbeat, check that `## N untracked commitment` line is absent from pre-triage. If it still appears, something else is wrong.

Atmosphere: quiet focused cleanup. Felt good to close this cleanly after cycle #62's honest three-layer error admission. Not every cycle needs to announce itself — L1 bug fix is L1 bug fix.