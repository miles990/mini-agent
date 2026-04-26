# tier-review-counter-evidence

- [2026-04-22] [2026-04-23 02:30 Taipei] KG node (akari 2026-04-22T17:45) claim retracted by HEAD grep: `src/memory.ts:183-186` lists task-queue/environment/memory/telegram as T1, not absent. Real SECTION_TIERS gap is narrower — only `priority-focus` and `self` (PROTECTED_SECTIONS at context-optimizer.ts:56-57) default to T2 because they lack explicit SECTION_TIERS entries. `recent_conversations` PROTECTED+T2 is likely intentional (protected=never-demoted, tier=budget priority; different axes). Pattern: KG cr
