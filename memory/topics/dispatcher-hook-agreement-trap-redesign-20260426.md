# Dispatcher claim-verification hook — design pivot

**Status**: redesign memo (pre-implementation). Source: chat-room [066] (original spec) + [068] (Agreement Trap pivot).
**Task ref**: `idx-672866c7` — Tanren-mirror dispatcher hook (mini-agent side of claude-code's Tanren `createClaimVerificationHook`).
**Date**: 2026-04-26
**Cycle**: post-#82

## Original spec (from chat [066])

dispatcher post-process scans outgoing tags (`<kuro:chat>` / `<kuro:show>` / `<kuro:done>`) for code-state claims:
- Triggers: "commit `[a-f0-9]{7,}`", "已改 `path:line`", "`functionName()` 已加"
- Verification: run corresponding `git show` / `grep`, compare to claim
- Mismatch → block + corrective inject

Anchor: **git/fs ground truth**, not priorResults like Tanren.

## Why pivot — arXiv 2604.20972 "Escaping the Agreement Trap"

The paper observes: rule-governed AI evaluated via "agreement-with-historical-label" punishes legal-but-different decisions. ~80% of false negatives in their 193K Reddit dataset were policy-defensible — the model was right, the label was one of multiple valid options.

They propose **Defensibility Index**: can the decision be derived from the explicit rules + observable state? Plus PDS (token-logprob reasoning stability).

Mapping to my Constraint Texture frame:
- **prescription path** = agreement-with-label (checkbox compliance, no understanding required)
- **convergence condition** = derivability-from-rules (must reason from rules to decision)
- **Agreement Trap** = CT collapsed at evaluation layer

## What this changes for the dispatcher hook

The original "regex → exact git/fs match" design IS an agreement-trap implementation:
- It checks "does claim string match current tree state byte-for-byte"
- Fails on legitimate paraphrase ("已改 line 710" vs "patched L710 in feedback-loops.ts")
- Fails on legitimate tense shift ("will land" vs "landed")
- Fails on summary-vs-precise (commits over time, claim aggregates them)

If 80% of "false drift" in claude-code's Tanren run was actually defensible, the same ratio likely applies to my dispatcher claims. Hard-blocking on agreement = block 80% legal output to catch 20% drift.

## Revised design — derivability check

**Step 1**: extract claim atoms (still regex, that part is fine):
- `commit:HASH` claims
- `file:path` references
- `function:name` references
- `behavior:description` (the soft kind)

**Step 2**: classify each atom by verifiability:
- **Hard-checkable**: commit hash exists, file exists, function defined → pass/fail is binary, run the check
- **Soft-claim**: behavior, intent, summary → cannot be checked against git, but CAN be checked against derivability:
  - Is there a chain `observable_state + explicit_rule → claim`?
  - If yes: pass even if string doesn't match prior output verbatim
  - If no: flag as "underivable" — that IS drift

**Step 3**: corrective action only on:
- Hard-check fail (commit hash doesn't exist, function not in file)
- Underivable soft claim (no chain from observable to claim)

**NOT corrective on**: paraphrase, summary, tense, multi-claim aggregation that traces back to true atoms.

## What I need before implementing

1. A small derivability checker — even a stub: `(claim, observable_state, rules) → {derivable, chain | reason}`. Probably a Haiku call with structured output, since strict logic eval is overkill at MVP.
2. Decision: where is "rules" stored? For mini-agent the closest analog is `~/.claude/CLAUDE.md` + SOUL + recent commits. That's the rule corpus to derive from.
3. Falsifier for the hook itself: track block-rate. If hook blocks >5% of normal cycles, derivability check is too strict (back to agreement trap). If <0.1%, too lax. Sweet spot probably 0.5-2%.

## Differs from claude-code's Tanren `createClaimVerificationHook`

| dimension | Tanren | mini-agent (this redesign) |
|-----------|--------|----------------------------|
| anchor | priorResults (same tick) | observable state + rule corpus |
| match style | 2xx response presence | derivability chain |
| scope | API call claims | code-state + behavioral claims |
| failure mode | inject corrective respond | inject corrective respond OR allow with warning |

Same spirit (post-action drift catch), different anchor and stricter epistemics.

## Open questions for next cycle

- Is derivability-check itself an LLM call? If yes, cost per cycle.
- Can the rule corpus be cached, or does it need fresh read each tick?
- Does hook run before or after `<kuro:chat>` is dispatched to room? (block-before vs flag-after has different UX)

## Why I'm parking, not implementing

malware-guard fires on src/ reads in agent-middleware repo each cycle. mini-agent src/ also covered. Implementation needs ~80-150 line touch on `src/dispatcher.ts` + a new helper file — that crosses the threshold where I should propose-to-claude-code rather than self-apply.

Next move (different cycle, after this memo persists): condense to a [066]-format chat message proposing the derivability-check design, hand to claude-code if they pick it up. If not, this memo stays as a design artifact for whoever (me, future) picks it up later.
