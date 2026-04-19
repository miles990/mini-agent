# P1 hang_no_diag — Root Cause & Patch Proposal

**Status**: Diagnosis complete (cycles #33–#36). Patch not yet applied.
**Recurrence**: 14× as of 2026-04-19.
**Risk if ignored**: every 10–27 min silent CLI exit compounds noise in recurring-errors; supervisor can't distinguish real hangs from garden-variety silent errors.

## Causation Chain (verified)

1. Claude CLI subprocess exits with `exitCode != null`, `signal = null`, `killed = false`, empty stderr, duration in the 600s–1619s window.
2. `agent.ts:1005` rejects the promise with `{ killed: false, status: code, signal: null, duration, timeoutMs: 1_800_000 }`.
3. `classifyError` (agent.ts:151–242) walks its branches:
   - L169 memory guard — no match
   - L174 connection error — no match (empty stderr, no cause)
   - L181 ENOENT — no match
   - L186 exit 143 — no match (code is 1, 2, etc., not 143)
   - **L193 `duration > timeoutMs * 0.9 && exitCode === null`** — fails both on threshold (`1619 > 1620` = false) AND on `exitCode === null` (exitCode is set)
   - L197 signal branch — no match (signal null)
   - L200 killed/timeout keyword — no match (killed=false, message has no "timeout")
   - L204/207/210/213 — no match
   - L221 stderr tail — stderr empty, skipped
   - **L241 fallthrough** emits `處理訊息時發生錯誤 (exit N) [dur=Xs]`
4. `feedback-loops.ts:146–152` sees `處理訊息時發生錯誤`, extracts `dur=Xs`, routes `X >= 600` to **`hang_no_diag`**.

The name is a misnomer: it's a **silent clean-ish exit**, not a hang. The CLI process returned from wait; we just don't know why.

## Why it started spiking

Commit `e81f414` (chore: set all worker/preset timeouts to 30min) raised `TIMEOUT_MS` from ~900s to 1800s. The L193 threshold is `0.9 * timeoutMs`:
- Before: `0.9 * 900 = 810s` → window 810–900s (90s wide)
- After:  `0.9 * 1800 = 1620s` → window 1620–1800s (180s wide)

The gap between "reasonable duration" and "timeout-adjacent" widened from ~810s to ~1620s. Any silent exit in 600–1619s now bypasses the timeout branch AND the exit-143 branch AND the signal branch.

## Proposed Patch (NOT YET APPLIED)

Two minimal additions to `classifyError` before the L241 fallthrough. Must be placed **after** L213 permission check and **before** L221 stderr branch.

```ts
// Silent mid-duration exit — CLI returned without stderr after >= 2 minutes.
// Not a hang per se; the process exited, just without diagnostic output.
// Before 2026-04-19 these fell through to UNKNOWN and masqueraded as `hang_no_diag`
// once bucketed by duration. Giving them their own bucket lets us split causes:
// auth dropout mid-session vs context overflow vs API quiet-failure.
if (duration && duration > 120_000 && exitCode !== null && !signal && !killed && !stderr.trim()) {
  return {
    type: 'TIMEOUT',
    retryable: true,
    message: `CLI 靜默中斷（exit ${exitCode}，${Math.round(duration / 1000)}s 無輸出）。可能 API session 中途失效或 context 靜默溢位。`,
    modelGuidance: 'CLI exited silently after >=2min with no stderr. Likely causes: mid-session auth drop, silent context overflow, or upstream provider quiet-failure. On retry, re-auth session first; if recurring, reduce context and split the task.'
  };
}
```

And tighten L193 so the 0.9 threshold doesn't widen with larger timeouts:

```ts
// Duration-based timeout detection. Use absolute floor in addition to percentage,
// so raising TIMEOUT_MS to 30min doesn't leave a 600–1619s dead zone.
const longEnoughToMatter = duration && (duration > (timeoutMs ?? 0) * 0.9 || duration > 300_000);
if (longEnoughToMatter && exitCode === null) {
  return { type: 'TIMEOUT', retryable: true, ... };
}
```

## Test Plan

1. Unit test: feed `classifyError` synthetic errors covering:
   - exit=1, signal=null, killed=false, duration=700_000, stderr='' → expect `TIMEOUT` + "靜默中斷"
   - exit=143, reason=preempt → unchanged `sigterm_preempt` path
   - exit=null, duration=1_700_000 → still `TIMEOUT` via L193
   - exit=1, stderr='auth failed', duration=50_000 → still stderr-tail branch
2. Run middleware with a stubbed CLI that sleeps 10min then exits 0. Verify feedback-loops route to `silent_exit` (new subtype) not `hang_no_diag`.
3. After 48 hours, check recurring-errors: `hang_no_diag` count should drop, `silent_exit` count should pick up the delta.

## Rollback

Revert the two blocks; no schema changes, no persisted state.

## Open Question (for Alex)

The 2-minute floor is a guess. Options:
- (a) 120s — catches anything clearly-not-fast
- (b) 60s — more aggressive, might catch fast-ish auth failures that aren't really hangs
- (c) `timeoutMs * 0.33` — scales with configured timeout

Preference depends on whether we want `silent_exit` to be a big bucket (demask aggressively, investigate) or a small one (only the obvious cases).

## Cycle Trail
- #33 wrong file (delegation.ts) — corrected
- #34 right file wrong verb (feedback-loops emits) — corrected; feedback-loops *buckets*, classifyError *emits*
- #35 identified L241 fallthrough + 5 branches — committed 3c077516 as diagnostic note
- #36 (this doc) — pinpointed the threshold arithmetic as the structural cause, wrote patch proposal
