# Commitment Counterparty + Ack — Distinguish Self-Broken from Counterparty-Blocked

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Split the current `expired` status (TTL-only) into two distinct outcomes — `expired` (I promised to act, didn't act, my fault) and `abandoned` (I asked counterparty to act/ack, they didn't, not my falsification). This stops counterparty-unresponsive commitments from inflating the PERFORMATIVE SKEPTICISM signal (currently 1736 expired entries, many of which are unanswered chats to Alex / Akari, not Kuro's own broken promises).

**Why now:** Cycle 128 audit + Coopetition-Gym arxiv 2605.02063 mechanism class 2 (trust/reputation) directly shows the gap. Concrete trigger: cl-373 has been in `wait state` for 9+ hours with no Alex reply; under current schema if TTL=257 ever ran out it would log as `expired` despite being purely counterparty-blocked. This patch makes the trust/verification asymmetry observable instead of laundering it through one bucket.

**Tech Stack:** TypeScript strict mode, no new dependencies. Single file change (`src/commitment-ledger.ts`); ledger format stays JSONL append-only with backward-compatible defaults.

**Cross-ref:** Orthogonal to cl-83 falsifier_query patch (verification layer); this is the trust layer.

---

## Decision Table — TTL Expiry Resolution

> Pattern stolen from Bun PORTING.md `LIFETIMES.tsv`: pre-flatten the decision space so the implementer (LLM or human) looks up the row instead of re-deriving from prose. **All 6 input combinations are explicit; no row is "implementation defined".**

| # | counterparty | ack_at  | ttl exceeded | resolved? | → status     | rationale                                                                |
|---|--------------|---------|--------------|-----------|--------------|--------------------------------------------------------------------------|
| 1 | self / unset | n/a     | yes          | no        | `expired`    | I promised, I didn't deliver. Counts against execution rate.             |
| 2 | alex/akari/system/external | null    | yes | no  | `abandoned`  | Asked counterparty, never acknowledged. NOT my falsification. Excluded from rate. |
| 3 | alex/akari/system/external | non-null| yes | no  | `expired`    | They acknowledged, I still didn't follow through after ack. My fault.    |
| 4 | (any)        | (any)   | no           | no        | `pending`    | Still in TTL window. No-op.                                              |
| 5 | (any)        | (any)   | (any)        | yes (kept)| `kept`       | Falsifier proven. Terminal state set at proof time.                      |
| 6 | (any)        | (any)   | (any)        | yes (refuted)| `refuted` | Falsifier triggered. Terminal state set at trigger time.                 |

**Forbidden combinations (compile-time refused, fail loud):**
- `status=abandoned` with `counterparty='self'` → invariant violation; self-commitments cannot be abandoned (no one else to wait on).
- `ack_at` set with `counterparty='self'` → meaningless field; reject at write time.

**Audit math (Task 3):**
- `eligible = all.filter(e => e.status !== 'abandoned')`
- `last20 = eligible.slice(-20)`
- `PERFORMATIVE_SKEPTICISM` fires iff `last20.length >= 5 AND (kept+refuted)/last20.length < 0.3`
- Row #2 (`abandoned`) is **invisible** to this metric by construction.

**Write-site rule (Task 4):** caller MUST pass `counterparty` ≠ `'self'` when the commitment's resolution depends on an external actor. Default `'self'` is correct only for "I will do X by cycle N" predictions.

---

## Task 1: Schema — add `counterparty` + `ack_at`, extend `status` enum

**Files:**
- Modify: `src/commitment-ledger.ts:10-25` (`CommitmentEntry` interface)

**Context:** Current `CommitmentEntry.status` has 4 values and no notion of who the commitment depends on. New optional fields default to self-actionable for backward compat.

**Step 1: Extend CommitmentEntry**

```typescript
// BEFORE (lines 10-25):
export interface CommitmentEntry {
  id: string;
  cycle_id: number;
  prediction: string;
  falsifier: string | null;
  ttl_cycles: number;
  status: 'pending' | 'kept' | 'refuted' | 'expired';
  // ...
}

// AFTER:
export interface CommitmentEntry {
  id: string;
  cycle_id: number;
  prediction: string;
  falsifier: string | null;
  ttl_cycles: number;
  status: 'pending' | 'kept' | 'refuted' | 'expired' | 'abandoned';
  // who needs to act for this commitment to resolve. defaults to 'self' for legacy entries.
  counterparty?: 'self' | 'alex' | 'akari' | 'system' | 'external';
  // ISO timestamp counterparty acknowledged the ask (chat reply, system event, etc.).
  // null/undefined = no ack received yet.
  ack_at?: string | null;
  created_at: string;
  resolved_at?: string;
  resolution_evidence?: string;
  falsifier_query?: FalsifierQuery;
  last_checked_cycle?: number;
  check_budget?: 'cheap' | 'delegate';
}
```

**Verify:** `grep -n "counterparty\|ack_at" src/commitment-ledger.ts` returns ≥3 hits (interface + at least 2 use-sites added in later tasks). `tsc --noEmit` passes.

---

## Task 2: TTL expiry — branch on counterparty + ack_at

**Files:**
- Modify: `src/commitment-ledger.ts:263-278` (`expireOverdueCommitments`)

**Context:** Today every overdue commitment becomes `expired`. We want: counterparty=self → `expired`; counterparty≠self AND ack_at is null → `abandoned`; counterparty≠self AND ack_at is set but unresolved → `expired` (they ack'd, I still didn't follow through).

**Step 1:**

```typescript
// AFTER:
export function expireOverdueCommitments(currentCycleId: number): number {
  const pending = readPendingCommitments();
  let count = 0;
  for (const entry of pending) {
    if (currentCycleId - entry.cycle_id >= entry.ttl_cycles) {
      const cp = entry.counterparty ?? 'self';
      const ack = entry.ack_at ?? null;
      const nextStatus: CommitmentEntry['status'] =
        cp !== 'self' && ack === null ? 'abandoned' : 'expired';
      const evidence =
        nextStatus === 'abandoned'
          ? `ttl_cycles=${entry.ttl_cycles} exceeded; counterparty=${cp} never acknowledged`
          : `ttl_cycles=${entry.ttl_cycles} exceeded at cycle ${currentCycleId}`;
      updateCommitmentStatus(entry.id, nextStatus, evidence);
      count++;
    }
  }
  if (count > 0) slog('LEDGER', `expired/abandoned ${count} overdue commitments`);
  return count;
}
```

**Verify:** Write unit test in `tests/commitment-ledger.test.ts` (create if absent) — three commitments with TTL=1, counterparty `self` / `alex` (no ack) / `alex` (with ack_at set) → after `expireOverdueCommitments` they read as `expired` / `abandoned` / `expired` respectively.

---

## Task 3: Audit metrics — exclude `abandoned` from execution rate

**Files:**
- Modify: `src/commitment-ledger.ts:140-194` (`auditCommitments`)
- Modify: `src/commitment-ledger.ts:317-318` (stats line)

**Context:** PERFORMATIVE SKEPTICISM = (kept+refuted) / total < 30% over last 20. If half of those are `abandoned` (counterparty's silence, not Kuro's failure), the signal is wrong. Solution: drop `abandoned` from both numerator and denominator — they're suspended, not unresolved-by-Kuro.

**Step 1: Filter the last20 sample**

```typescript
// BEFORE:
const last20 = all.slice(-20);
const last20Resolved = last20.filter(
  e => e.status === 'kept' || e.status === 'refuted',
).length;

// AFTER:
const last20Eligible = all.filter(e => e.status !== 'abandoned').slice(-20);
const last20Resolved = last20Eligible.filter(
  e => e.status === 'kept' || e.status === 'refuted',
).length;
const performativeSkepticism =
  last20Eligible.length >= 5 && last20Resolved / last20Eligible.length < 0.3;
```

**Step 2: Add `abandoned` count to `CommitmentAudit` and stats line**

```typescript
// CommitmentAudit interface (line 42):
export interface CommitmentAudit {
  pending: number;
  kept: number;
  refuted: number;
  expired: number;
  abandoned: number;  // NEW
  // ...
}

// auditCommitments computation:
const abandoned = all.filter(e => e.status === 'abandoned').length;

// buildLedgerSection stats line (line 318):
lines.push(
  `Stats: pending=${audit.pending} kept=${audit.kept} refuted=${audit.refuted} ` +
  `expired=${audit.expired} abandoned=${audit.abandoned}`
);
```

**Verify:** `buildLedgerSection` output renders `abandoned=N` in stats line. Performative-skepticism warning does not fire when the only "unresolved" entries are counterparty-abandoned.

---

## Task 4: Write-site convention — set `counterparty` at commitment creation

**Files:**
- Read-only audit: `grep -rn "writeCommitment(" src/` — find every call site.

**Context:** No code change in this task — instead document the convention in the docstring on `writeCommitment` so callers explicitly pass `counterparty` for non-self entries (chats waiting on Alex reply, delegate dispatches waiting on subprocess, etc.). Ack-on-reply wiring (Task 5) is the real lift; this is just making the field discoverable.

**Step 1:** Add a JSDoc block above `writeCommitment` (line 96) explaining:
- Default counterparty='self' (legacy, no field needed)
- Set counterparty='alex' when emitting `<kuro:chat>` that requests action
- Set counterparty='akari' for inter-agent asks
- Set counterparty='system' when waiting on cron/external service

---

## Task 5 (FOLLOW-UP, separate plan): Ack-on-reply wiring

**Out of scope for this plan.** The actual `ack_at` setter needs a hook in the chat-receive path (likely `dispatcher.ts` chat-handler) that, on inbound message from Alex, scans pending commitments with counterparty='alex' AND prediction-text-overlap or explicit `ack:cl-XXX` syntax, and sets `ack_at = now()`. That's a separate plan because it needs UX decision: implicit fuzzy match vs explicit ack syntax.

This plan ships the schema + audit logic so future ack wiring has a target shape.

---

## Acceptance

- [ ] `tsc --noEmit` passes
- [ ] Existing commitments load with `counterparty=undefined` and behave as `self` (backward compat)
- [ ] Three-case unit test in Task 2 passes
- [ ] Ledger section in next loop renders `abandoned=N` in stats
- [ ] After running on real `commitments.jsonl` once with a manual migration (counterparty='alex' for any prediction containing 'chat' or 'tag Alex'), PERFORMATIVE SKEPTICISM warning recomputes — expect it to either disappear or persist with a much smaller eligible denominator.
