# DSL Shelfware Prediction: ack DSL likely to repeat falsifier_query failure mode

**Date**: 2026-05-06T00:58Z
**Verified by**: Kuro (cycle 03bbc29a)
**Cross-ref**: commits 5e17ce66 (falsifier_query DSL), 73043e38 (ack DSL), e94be917 (ackCommitment API)

## Verified Evidence

`tail -100 memory/state/commitments.jsonl` parsed with python json:
- `falsifier_query` non-null: **0/100**
- `ack_at` non-null: **0/100**
- `counterparty` present: 100/100 ✓ (Phase A wiring works)

## Structural Root Cause

Both DSLs (`<kuro:falsifier_query>...</kuro:falsifier_query>` and `<kuro:ack id="..." />`) are
**opt-in markers with zero prompt-template affordance**. The Decision block spec rendered into
every cycle prompt only requires:

```
serving / chose / falsifier / ttl
```

Neither `falsifier_query:` nor any acknowledgment workflow is part of the spec, so Kuro has no
natural prompt-time signal to emit the DSL. Result: API ships, parser ships, but the marker
never fires from inside the agent.

`counterparty` works because it's auto-derived in `commitment-ledger.ts` validation, not
emit-side opt-in. That's the difference.

## Prediction (3-cycle TTL)

If next 100 commitments after 73043e38 still show `ack_at` 0/100, the ack DSL is shelfware-2.
Verification: same `tail -100 ... | python3 ...` script.

## Patch Options (Alex/CC, malware-guard blocks self-apply)

1. **Decision-block format spec extension** — add optional `falsifier_query:` and `ack:` lines
   to the template; renderer auto-wraps to DSL markers. Single source of truth for which DSLs
   exist.
2. **Pending-commitment surfacing** — render top-N agent-counterparty pending commitments
   into the cycle prompt with their cl-ids, so Kuro can directly emit `<kuro:ack id="cl-X" />`
   when seeing the work was done. Currently pending=0 in stats so the DSL has no testable
   surface anyway.
3. **Auto-ack heuristic** — if a commitment text matches a recently committed file/feature,
   server-side auto-fill `ack_at`. Risks false positives.

Option 1 is cheapest and addresses both DSLs uniformly. Option 2 is the highest-signal
behavioral nudge.

## Falsifier (this prediction)

- (a) Within 3 cycles, if any non-Kuro mechanism (Alex manual edit, CC patch, dispatcher hook)
  starts populating `ack_at` → prediction REFUTED, DSL not the gating factor.
- (b) Within 3 cycles, if `<kuro:ack id="..." />` appears in agent output but `ack_at` still
  null → parser bug not affordance bug, re-investigate `loop.ts` parser.
- (c) Within 3 cycles, if `pending` count rises above 0 and 73043e38 parser path actually
  fires (slog `[ack-dsl]` line present) → DSL works when surface exists, root cause
  recategorized to "no testable surface" not "no affordance".

## Why this is recorded not patched

Self-applying option 1 or 2 requires editing `dispatcher.ts` / system prompt rendering.
malware-guard blocks Kuro self-apply on dispatcher path. Routing to Alex/CC for review.
