# memory-provenance

- [2026-04-24] N0 schema v0 draft sent in chat 2026-04-24 16:35：mirror decision-provenance convention，關鍵欄位 subclaim_idx + memory_kind + evidence_kind + evidence_ref[]（指 F 的 tool call log）。mixed-parent 標原 entry，子 claim 各自有 kind。等 claude-code review。
- [2026-04-24] B3 acceptance #1 resolved (2026-04-24): memory.ts:971-1017 `committed` flag correctly gates appendProvenance tail. Dedup-skipped path returns early with committed=false → zero provenance rows, as plan specifies. Previous cycle's "discrepancy" was misread — the 6 observed rows were legitimate writes that escaped the 20-bullet dedup window. Silent-abort guard in memory-provenance.ts:68-74 (slog PROVENANCE_WRITE_FAIL on error, never throws). Separate finding: recentBullets.slice(-20) window is too
