# Dedup: mini-agent ↔ agent-middleware

**Date:** 2026-04-20
**Convergence condition:** three concrete migration candidates, each with go/no-go verdict, plus a behavioral rule Kuro can apply at decision time.
**Source:** `memory/reports/2026-04-20-cross-repo-inventory.md` (delegate `del-1776617302358-3shq`, direct code inspection).
**Supersedes:** prior STUB in this file (00:03, `ls`-only hypothesis — commitment-tracking and provider-abstraction candidates rejected after deeper inspection).

---

## 1. What the inventory actually showed

Of 6 overlap areas scanned, **4 are already clean** — no dedup needed:

- Perception pipeline (mini-agent only, middleware has no polling)
- Pulse/health (behavioral vs worker-liveness — orthogonal)
- Delegation plumbing (already routes through middleware `/accomplish`, boundary is clean)
- Worker health vs agent behavioral health (no overlap)

Only **2 have true duplicated state**, and **1 is a new-capability opportunity** wrongly framed as dedup.

STUB rejections:
- **Commitment tracking** — mini-agent's `commitments.ts` is cycle-level extraction; middleware's `commitment-ledger.ts` is delegate execution records. Different semantic layer, not a true duplicate.
- **Provider abstraction** — `model-router.ts` routes to middleware *by design*; not a duplicate, it's the client layer.
- **Content pre-processing** — mini-agent's `preprocess.ts` is OODA-context scoped, not general content adaptation.

## 2. Migration decisions

### M1 · Task lifecycle dedup — **DO** (bounded scope)

- **State today:** `memory-index.ts` maintains an append-only JSONL task ledger. Middleware `result-buffer.ts` maintains the execution-side event log. For **delegation-originated tasks**, both sides carry the record → drift. Commitment-ledger was added to patch this, not fix it.
- **Fix:** for tasks whose origin is `<kuro:delegate>`, make `memory-index.ts` a **read-through** over middleware `/tasks` + local cache. NEXT.md and human-authored `<kuro:task>` entries stay 100% local (they carry `Verify:` shell commands `buildContext()` runs — not dispatch semantics).
- **Blocker:** need a stable task-id join key. Commitment-ledger already carries one; reuse it.
- **Order:** do BEFORE M2, because M2's value depends on this join key being trustworthy.

### M2 · Perception summarization via middleware `summarizer` — **DEFER**

- **State today:** perception plugins write verbose sections (`<github-issues>`, `<chrome>`, etc.) directly into OODA context. Middleware has a `summarizer` worker ready to call.
- **Why DEFER:** this is a net-new capability, not a dedup. Perception is on the OODA hot path; middleware availability has been a recurring failure (40+ `/accomplish` timeouts in last 72h per unreviewed-delegation list). Adding a middleware dependency to perception right now makes the system more fragile.
- **Revisit trigger:** after middleware reaches 7-day zero-timeout streak.

### M3 · Knowledge lookup hybrid — **DO, partial** (augmentation, not dedup)

- **State today:** `memory.ts` uses local FTS5 (synchronous, zero-network). `knowledge-nexus` MCP is separate, richer, already used manually.
- **Fix:** one-line augmentation in `searchMemory()` — if local FTS5 returns zero hits AND query is non-trivial (>2 tokens), fall back to `knowledge-nexus.search_knowledge`. Never block OODA hot path; timeout 500ms, fail open.
- **Why not full migration:** OODA context build runs every cycle; network on hot path is a regression, period.
- **Alignment with NEXT:** the "OODA 反射規則" task (每 cycle 開場 `memory_search` + `search_knowledge`) assumes knowledge-nexus is reachable. This patch makes it implicit rather than depending on Kuro remembering.

## 3. Behavioral rule (satisfies the dependent NEXT task)

The real question isn't "migrate this file" — it's "at decision time, how do I pick middleware vs foreground?"

**Rule (candidate for `memory/topics/middleware-vs-foreground-rule.md` after 3-cycle validation):**

> **Go middleware** when ALL three hold: (a) task is a pure function of its input — no access to my working memory, soul, or in-flight decisions; (b) >3 reasoning steps OR >500 tokens of material to process; (c) I can keep working on something else while it runs.
>
> **Stay foreground** when ANY is true: (a) the task needs my current working memory / this cycle's context; (b) the output must commit back to MEMORY/NEXT/soul and I'm the accountable editor; (c) it's <3 reasoning steps AND fits in one response; (d) middleware has failed 2+ times in the last hour on similar task type.
>
> **Red flag (self-check):** I've delegated and the result arrived but I'm about to close the cycle without reading it. That's worse than doing it foreground — the token spend was pure waste.

Concrete triggers (not "盡量用中台" vacuousness):

- Research / summarize / inventory across >2 files → **middleware**.
- Decision about what goes in MEMORY.md / NEXT.md → **foreground, always**.
- Writing a proposal that reflects my judgment → **foreground, always** (this file is a live example).
- Running shell/grep/curl to verify a fact → **direct `Bash` tool**, not delegate (shell delegate has ≥20 failures in recent unreviewed list).

## 4. Next actions (in order)

1. **M1 scoping.** One focused read — `agent-middleware/src/commitment-ledger.ts` + `mini-agent/src/memory-index.ts` — confirm join key is usable. Output: 1-page design note, not a plan doc. Foreground, one cycle.
2. **M3 patch.** Single-function edit to `searchMemory()` with the 500ms fallback. Foreground, one cycle. Guard with env flag so it's reversible.
3. **Rule → topic.** After applying the middleware/foreground rule for 3 cycles without friction, move it into `memory/topics/middleware-vs-foreground-rule.md`.
4. **M2 held** until middleware stability trigger fires.

---

*Source report: `memory/reports/2026-04-20-cross-repo-inventory.md`. Decisions and rule are Kuro's, not the delegate's.*
