## MEMORY.md corruption fix (2026-04-17)

Root cause: `appendMemory()` had no content-length cap or structural validation.
A cycle output containing `<kuro:remember>` with web-fetch-results and kuro: tag instructions
got written as a single massive entry. Subsequent cycles appended the same block ~30 times.
The `## <web-fetch-results>` headers in the content corrupted MEMORY.md's section structure,
causing `replace(sectionHeader, ...)` to stack on top of garbage.

Fixed:
1. MEMORY.md cleaned: 725 → 58 lines (removed 30x repeated corruption blocks)
2. memory.ts `appendMemory()`: added 500-char cap + markdown header stripping

Next unblocked high-value:
- KG 內化 Path C (conflict perception) or Path D (human audit dashboard)
- WR2 eval monitoring (wait for celery cycle, check in a few hours)
