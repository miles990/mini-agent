import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Phase F (cycle 17, 2026-05-05): tests for the trust-layer branching shipped
// across phases A-E. Verifies that expireOverdueCommitments distinguishes
// 'abandoned' (agent counterparty never acked) from 'expired' (self-promise
// or manual ttl-out). Motivating case: cl-373 Alex 9hr no-reply.

let tmpStateDir: string;

vi.mock('../src/memory.js', () => ({
  getMemoryStateDir: () => tmpStateDir,
}));

vi.mock('../src/utils.js', () => ({
  slog: vi.fn(),
}));

import {
  writeCommitment,
  expireOverdueCommitments,
  auditCommitments,
  readPendingCommitments,
} from '../src/commitment-ledger.js';

describe('commitment-ledger trust-layer branching', () => {
  beforeEach(() => {
    tmpStateDir = mkdtempSync(path.join(tmpdir(), 'cl-test-'));
  });

  afterEach(() => {
    rmSync(tmpStateDir, { recursive: true, force: true });
  });

  it('agent commitment without ack_at expires as "abandoned"', () => {
    const id = writeCommitment({
      cycle_id: 1,
      prediction: 'Alex will reply about hero painterly style',
      falsifier: 'no reply within ttl',
      ttl_cycles: 3,
      counterparty: { kind: 'agent', agent_id: 'alex' },
    });
    expect(id).toMatch(/^cl-1-/);

    // Advance to a cycle past ttl. ttl=3 means by cycle 1+3=4 it is overdue.
    const total = expireOverdueCommitments(4);
    expect(total).toBe(1);

    const audit = auditCommitments(4);
    expect(audit.abandoned).toBe(1);
    expect(audit.expired).toBe(0);
    expect(audit.pending).toBe(0);

    expect(readPendingCommitments()).toHaveLength(0);
  });

  it('self commitment without ack_at expires as "expired" (not abandoned)', () => {
    writeCommitment({
      cycle_id: 1,
      prediction: 'I will rewrite the resolver',
      falsifier: 'no commit landed',
      ttl_cycles: 3,
      counterparty: { kind: 'self' },
    });

    expireOverdueCommitments(4);
    const audit = auditCommitments(4);
    expect(audit.expired).toBe(1);
    expect(audit.abandoned).toBe(0);
  });

  it('legacy commitment (no counterparty field) treated as "expired"', () => {
    // Backward-compat: 1740 legacy entries lack counterparty. Must not
    // accidentally classify as abandoned.
    writeCommitment({
      cycle_id: 1,
      prediction: 'legacy entry',
      falsifier: null,
      ttl_cycles: 2,
    });
    expireOverdueCommitments(10);
    const audit = auditCommitments(10);
    expect(audit.expired).toBe(1);
    expect(audit.abandoned).toBe(0);
  });

  it('agent commitment WITH ack_at expires as plain "expired"', () => {
    // ack_at means the counterparty engaged, so timeout is on ME, not them.
    // The trust signal is "they responded but I didn't follow through" —
    // that's expired (own falsifier ran out), not abandoned.
    writeCommitment({
      cycle_id: 1,
      prediction: 'will produce report after Alex confirms',
      falsifier: 'report missing',
      ttl_cycles: 2,
      counterparty: { kind: 'agent', agent_id: 'alex' },
      ack_at: new Date().toISOString(),
    });
    expireOverdueCommitments(5);
    const audit = auditCommitments(5);
    expect(audit.expired).toBe(1);
    expect(audit.abandoned).toBe(0);
  });

  it('within-ttl commitments stay pending (not expired)', () => {
    writeCommitment({
      cycle_id: 5,
      prediction: 'still in flight',
      falsifier: 'no signal yet',
      ttl_cycles: 5,
      counterparty: { kind: 'agent', agent_id: 'alex' },
    });
    // currentCycleId 7, delta=2 < ttl=5 → pending
    expireOverdueCommitments(7);
    const audit = auditCommitments(7);
    expect(audit.pending).toBe(1);
    expect(audit.abandoned).toBe(0);
    expect(audit.expired).toBe(0);
  });

  it('writeCommitment rejects ack_at without counterparty', () => {
    expect(() =>
      writeCommitment({
        cycle_id: 1,
        prediction: 'invalid',
        falsifier: null,
        ttl_cycles: 1,
        ack_at: new Date().toISOString(),
      }),
    ).toThrow(/ack_at requires counterparty/);
  });

  it('writeCommitment rejects agent counterparty without agent_id', () => {
    expect(() =>
      writeCommitment({
        cycle_id: 1,
        prediction: 'invalid',
        falsifier: null,
        ttl_cycles: 1,
        counterparty: { kind: 'agent', agent_id: '' },
      }),
    ).toThrow(/requires agent_id/);
  });

  it('mixed batch: 1 agent-no-ack + 1 self + 1 still-pending', async () => {
    // Distinct cycle_ids needed because id = `cl-${cycle_id}-${Date.now()}`,
    // which can collide for synchronous same-cycle writes. (Real-world writes
    // are separated by tool calls; the test exposes the boundary condition.)
    writeCommitment({
      cycle_id: 1,
      prediction: 'agent task',
      falsifier: null,
      ttl_cycles: 2,
      counterparty: { kind: 'agent', agent_id: 'akari' },
    });
    writeCommitment({
      cycle_id: 2,
      prediction: 'self task',
      falsifier: null,
      ttl_cycles: 2,
      counterparty: { kind: 'self' },
    });
    writeCommitment({
      cycle_id: 4,
      prediction: 'fresh',
      falsifier: null,
      ttl_cycles: 5,
      counterparty: { kind: 'self' },
    });

    expireOverdueCommitments(5);
    const audit = auditCommitments(5);
    expect(audit.abandoned).toBe(1);
    expect(audit.expired).toBe(1);
    expect(audit.pending).toBe(1);
  });
});
