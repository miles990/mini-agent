# Correction Gate: pending-pledge resolved (2026-05-06T01:09Z)

## What changed
Gate score 53 → 93, needsCorrection true → false. 0/3 pledges → 3/3.

## Pledges resolved
1. `idx-4cb21b7a-...3e0` (2026-05-01): "ship hn-kuro-curate.mjs" → completed by equivalent `scripts/kuro-daily-pick.mjs` (8019B, May 1) + output `memory/state/kuro-daily-pick/2026-05-{01,02,05}.md`. Script renamed, work shipped.
2. `idx-2197d657-...f28` (2026-05-01): same as above (duplicate pledge from same chat).
3. `idx-007dd205-...569` (2026-04-29): "patch loop.ts:2841-2851 A-gate silent-strip" → completed; HEARTBEAT line 1 already verified all 3 fixes live in src/loop.ts:2849-2889 since 2026-04-30.

## Found-but-not-fixed: scheduler task close blocked by verify_command timeout
The auto-generated correction-gate task `idx-35c354d9-...` carries `verify_command: 'pnpm typecheck && pnpm test'` (set in `correction-gate.ts:137`, NOT :160 as previously written — verified 2026-05-06T01:13Z via `Grep verify_command src/correction-gate.ts` → line 137 single hit). The verify gate in `memory-index.ts:626` runs with `timeout: 10000` ms. `pnpm test` cannot finish in 10s, so this class of task can never close via the verify path. Typecheck alone (`pnpm typecheck`) **does pass** in ~7s.

### Patch surface
- `src/correction-gate.ts:137` — change verify_command to a 10s-safe self-check, e.g. `pnpm typecheck` only, OR a node oneliner that re-evaluates the gate itself
- OR `src/memory-index.ts:626` — bump verify timeout for tasks with origin='correction-gate'
- self-apply blocked by malware-guard 2026-05-06T01:13Z (Read of correction-gate.ts triggered guard) — must be Alex/CC patch

### Lesson (off-by-23 line number)
Last cycle's working-memory said `correction-gate.ts:160` for the verify_command; the real line is :137. The :160 number was the line of `encoding: 'utf-8'` inside the unrelated `readShipTruth` function. Pattern: when quoting line numbers in working-memory, the next cycle MUST grep-verify before tagging Alex — otherwise a chat asking Alex to "patch :160" sends them to the wrong region.

### Falsifier
- abs path: `mini-agent/src/correction-gate.ts:137`
- op: `verify_command` string equality
- threshold: if `Grep "pnpm test" src/correction-gate.ts` returns 0 hits → patch landed; if still returns line 137 hit after 7 days → Alex hasn't picked it up, re-tag with corrected line in chat
