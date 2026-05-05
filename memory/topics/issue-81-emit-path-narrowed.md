# issue-81-emit-path-narrowed

- [2026-05-05] [2026-05-06T03:28Z cycle $2.62/$5] **Issue #81 narrowed by 2 layers via server.log forensics + loop.ts source read**: (a) instrumentation IS firing for plain-prose cycles (19:15:09 + 19:22:58 both `extractDecisionBlock returned null, has_decision_marker=false` — branch 3 working correctly when no `## Decision` heading). (b) Aeon cycle (19:18:19, full `## Decision` + `chose:` + `` + ``) produced **0 soft-gate slog + 0 LEDGER write** — bypassed all 4 branches. (c) loop.ts:2520-2705 has zero early
