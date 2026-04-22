# bug-hang_no_diag

- [2026-04-19] [2026-04-19] hang_no_diag root cause shift: duration ≥600s despite 90s CLI hard timeout = hang is in pre-reduction chain (rebuildContext → compactContext → rebuildContext), not CLI subprocess. agent.ts:1738-1769 has three sequential async LLM calls before CLI starts, none bounded by the 90s timer. Fix path: wrap each with 30s bounded timeout, classify as pre_reduction_hang to separate from true CLI hangs. 7d194410 (P1-d delegation converter) is NOT the cause — it doesn't touch callClaude. Disproved the bisect hypothesis.
