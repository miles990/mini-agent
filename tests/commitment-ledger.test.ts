import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
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
  parseFalsifierToQuery,
  resolveReadyCommitments,
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

  it('parses grep falsifier DSL into log_grep query', () => {
    const parsed = parseFalsifierToQuery('next cycle grep:/tmp/x.log "foo.*bar" >=3');

    expect(parsed).toEqual(expect.objectContaining({
      kind: 'log_grep',
      path: '/tmp/x.log',
      pattern: 'foo.*bar',
      op: '>=',
      threshold: 3,
    }));
    expect(parsed && parsed.kind === 'log_grep' ? parsed.since_iso : '').toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('parses grep falsifier DSL with explicit since timestamp', () => {
    const parsed = parseFalsifierToQuery('grep:/tmp/x.log "bar" since:2026-05-01T00:00:00Z ==0');

    expect(parsed).toEqual({
      kind: 'log_grep',
      path: '/tmp/x.log',
      pattern: 'bar',
      since_iso: '2026-05-01T00:00:00Z',
      op: '==',
      threshold: 0,
    });
  });

  it('auto-populates log_grep query and resolves kept when count meets threshold', () => {
    const logPath = path.join(tmpStateDir, 'server.log');
    writeFileSync(logPath, [
      '2026-05-06T00:00:00Z alpha',
      '2026-05-06T00:01:00Z alpha',
      '2026-05-06T00:02:00Z beta',
      '2026-05-06T00:03:00Z alpha',
    ].join('\n'), 'utf-8');

    writeCommitment({
      cycle_id: 10,
      prediction: 'alpha appears often enough',
      falsifier: `grep:${logPath} "alpha" since:2026-05-06T00:00:00Z >=3`,
      ttl_cycles: 5,
      counterparty: { kind: 'self' },
    });

    const resolved = resolveReadyCommitments(11);
    const audit = auditCommitments(11);

    expect(resolved).toEqual({ resolved: 1, skipped: 0 });
    expect(audit.kept).toBe(1);
    expect(readPendingCommitments()).toHaveLength(0);
  });

  it('resolves log_grep as refuted when count misses threshold', () => {
    const logPath = path.join(tmpStateDir, 'server.log');
    writeFileSync(logPath, [
      '2026-05-06T00:00:00Z alpha',
      '2026-05-06T00:01:00Z beta',
    ].join('\n'), 'utf-8');

    writeCommitment({
      cycle_id: 10,
      prediction: 'alpha appears three times',
      falsifier: `grep:${logPath} "alpha" since:2026-05-06T00:00:00Z >=3`,
      ttl_cycles: 5,
      counterparty: { kind: 'self' },
    });

    resolveReadyCommitments(11);
    const audit = auditCommitments(11);

    expect(audit.refuted).toBe(1);
  });

  it('treats missing log_grep file as refuted evidence', () => {
    writeCommitment({
      cycle_id: 10,
      prediction: 'missing log exists',
      falsifier: `grep:${path.join(tmpStateDir, 'missing.log')} "alpha" >=1`,
      ttl_cycles: 5,
      counterparty: { kind: 'self' },
    });

    resolveReadyCommitments(11);
    const ledger = readFileSync(path.join(tmpStateDir, 'commitments.jsonl'), 'utf-8');

    expect(auditCommitments(11).refuted).toBe(1);
    expect(ledger).toContain('does not exist');
  });

  it('filters ISO-timestamped log_grep lines by since timestamp', () => {
    const logPath = path.join(tmpStateDir, 'server.log');
    writeFileSync(logPath, [
      '2026-05-05T23:59:00Z alpha',
      '2026-05-06T00:00:00Z alpha',
      'alpha without timestamp',
    ].join('\n'), 'utf-8');

    writeCommitment({
      cycle_id: 10,
      prediction: 'old alpha is ignored, timestamp-less alpha is conservative-counted',
      falsifier: `grep:${logPath} "alpha" since:2026-05-06T00:00:00Z ==2`,
      ttl_cycles: 5,
      counterparty: { kind: 'self' },
    });

    resolveReadyCommitments(11);

    expect(auditCommitments(11).kept).toBe(1);
  });
});
