# kg-conflict-resolver-audit-20260417

- [2026-04-16] **23 resolved conflicts audit (2026-04-17)**:
- Type outcome correctness: 23/23 (100%)
- Rule label correctness: 21/23 (91%)
- Mislabels: #9 HEARTBEAT (R2 without ext), #16 PERCEPTION (R3 without PascalCase) — both are default/fallback cases mislabeled as named rules
- Rule distribution (actual): R1×6, R2×6, R3×5, R4×2, R5×1, R6×1, R8×2 = 23
- Structural finding: resolver lacks explicit R-default/R-fallback path — unclear-signal cases inherit nearest R* label
- File: memory/index/resolution-audit.jsonl
- Corrects my earlier 279 room msg ("R1-R5+MISC+untagged" — wrong)
