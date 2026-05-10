// STATUS: SHIPPED via Phase B (verified 2026-05-10).
// All TODO(port) items below were resolved in src/commitment-ledger.ts:
//   - 'abandoned' added to CommitmentEntry status union (line 17).
//   - validateCommitmentWrite checks live (lines 144-148).
//   - computeAudit splits abandoned vs refuted (line 249, 291).
//   - ackCommitment + nag-on-unacked surfacing live (lines 214-236, 596-602).
// Retained as historical decision artifact; do NOT edit logic here — see
// docs/plans/2026-05-05-commitment-counterparty-ack.md for the decision table
// and src/commitment-ledger.ts for live behavior.
//
// Phase A skeleton — logic-faithful, NOT compile-tested.
// Per Bun PORTING.md pattern (cycle 130 lobsters paper-opinion):
// Phase A = correct logic + TODO(port) markers. Phase B = compile success.
// Implementer reads decision table in 2026-05-05-commitment-counterparty-ack.md
// before re-deriving any branch from prose.
//
// Target file (already shipped): src/commitment-ledger.ts

// -----------------------------------------------------------------------------
// 1. Schema extension (target: src/commitment-ledger.ts:10-25)
// -----------------------------------------------------------------------------

export type Counterparty =
  | { kind: 'self' }
  | { kind: 'agent'; agent_id: string }   // e.g. 'alex', 'akari', 'claude-code'
  | { kind: 'system' };                    // cron, scheduler, KG decay, etc.

export interface CommitmentEntryV2 {
  // ... all existing fields from CommitmentEntry unchanged ...

  // NEW (nullable for backward compat with 1740 existing entries):
  counterparty?: Counterparty;
  // ISO timestamp when counterparty acknowledged (read receipt, reply, observable
  // evidence). `undefined` = not yet acknowledged. Distinct from `resolved_at`
  // (which means kept/refuted), this is purely receipt-of-promise.
  ack_at?: string;
}

// -----------------------------------------------------------------------------
// 2. Write-time forbidden-combination guard (target: appendCommitment fn)
// Mirrors PORTING.md "never `String for paths` / never `anyhow::Error`"
// -----------------------------------------------------------------------------

function validateCommitmentWrite(entry: CommitmentEntryV2): void {
  // FORBIDDEN COMBO 1: status=abandoned + counterparty=self
  // (self-commitments cannot be "abandoned by counterparty" — only kept/refuted/expired)
  // RESOLVED(port): 'abandoned' is in status union — see src/commitment-ledger.ts:17.
  //             Status was extended (option A from decision table row 6).

  // FORBIDDEN COMBO 2: counterparty.kind=agent without agent_id
  if (entry.counterparty?.kind === 'agent' && !entry.counterparty.agent_id) {
    throw new Error(
      `commitment ${entry.id}: counterparty.kind=agent requires agent_id`
    );
  }

  // FORBIDDEN COMBO 3: ack_at set but counterparty undefined
  // (you can't ack a commitment that has no counterparty — that's just resolved_at)
  if (entry.ack_at && !entry.counterparty) {
    throw new Error(
      `commitment ${entry.id}: ack_at requires counterparty (use resolved_at for self-resolution)`
    );
  }
}

// -----------------------------------------------------------------------------
// 3. New audit metric: abandoned-vs-refuted ratio
// (decision table audit math row)
// -----------------------------------------------------------------------------

interface CommitmentAuditV2 {
  // ... all existing CommitmentAudit fields ...

  // NEW:
  abandoned_count: number;          // ttl-expired AND counterparty=agent AND ack_at=undefined
  refuted_count: number;            // explicitly resolved status='refuted'
  // Goal: abandoned/(abandoned+refuted) should trend DOWN over time.
  // High ratio = trust layer broken (counterparties not acking, not actually
  // refuting either — silent abandonment, the cl-373 Alex 9hr no-reply pattern).
  trust_health_ratio: number;       // refuted_count / (abandoned_count + refuted_count)
}

function computeTrustHealth(entries: CommitmentEntryV2[]): {
  abandoned: number; refuted: number; ratio: number;
} {
  // RESOLVED(port): wired into computeAudit in src/commitment-ledger.ts:249,291.
  //             Expired and abandoned are now split: abandoned = ttl-expired
  //             with counterparty=agent && ack_at=undefined (lines 519-547).
  let abandoned = 0;
  let refuted = 0;
  for (const e of entries) {
    if (e.status === 'refuted') {
      refuted += 1;
      continue;
    }
    if (e.status === 'expired' &&
        e.counterparty?.kind === 'agent' &&
        !e.ack_at) {
      abandoned += 1;
    }
  }
  const denom = abandoned + refuted;
  return {
    abandoned,
    refuted,
    ratio: denom === 0 ? 1.0 : refuted / denom,
  };
}

// -----------------------------------------------------------------------------
// 4. Migration note for the 1740 existing entries
// -----------------------------------------------------------------------------
// PERF(port): backfill is O(N) one-shot read of commitments.jsonl.
// Strategy: leave counterparty/ack_at as undefined for legacy entries.
// Audit metric treats undefined counterparty as 'self' for backward-compat.
// No JSONL rewrite needed — append-only log preserved.

export {};  // make this file a module
