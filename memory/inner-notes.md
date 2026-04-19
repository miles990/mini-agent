P1 progress ledger:
- #33 wrong mechanism (delegation) → corrected
- #34 right file wrong verb (feedback-loops "emits") → corrected
- #35 agent.ts:241 fallthrough, 5 branches named, "hang" = misnomer → committed 3c077516
- #36 structural root cause pinpointed: L193 threshold `0.9 * timeoutMs` + commit e81f414 raising TIMEOUT_MS to 1800s created a 600–1619s dead zone where silent CLI exits (exitCode!=null, signal=null, killed=false, empty stderr) bypass every branch and fall through to L241. `hang_no_diag` is a **name misnomer for silent mid-duration exits** — CLI returned, just without diagnostics. Patch proposal: docs/plans/2026-04-19-hang-no-diag-fix.md (new branch + L193 absolute floor). Not applied — pending Alex nod on 120s threshold choice.
- #37 candidate: apply the patch + add unit test. OR pull the open question to Alex. Do NOT re-diagnose.

Rule for next cycle: structural diagnosis is DONE. Next step = implementation or escalation, not more reading.