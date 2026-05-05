import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendProviderClaim,
  getClaimLedgerPath,
  getRecentClaimsSummary,
  readProviderClaimsSync,
  transitionStoredProviderClaim,
} from '../src/claim-ledger.js';
import { createProviderClaim } from '../src/provider-claims.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-claims-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('claim ledger', () => {
  it('appends provider claims as KG-shaped JSONL records', () => {
    const claim = createProviderClaim({
      provider: 'codex',
      taskId: 'del-1',
      subject: 'delegation:del-1',
      predicate: 'reported_result',
      object: 'implemented claim bridge',
      confidence: 0.7,
    }, new Date('2026-05-05T00:00:00.000Z'));

    appendProviderClaim(tmpDir, claim);

    const claims = readProviderClaimsSync(tmpDir);
    expect(getClaimLedgerPath(tmpDir)).toBe(path.join(tmpDir, 'index', 'provider-claims.jsonl'));
    expect(claims).toEqual([
      expect.objectContaining({
        id: claim.id,
        provider: 'codex',
        taskId: 'del-1',
        status: 'hypothesis',
        object: 'implemented claim bridge',
      }),
    ]);
  });

  it('uses same-id-last-wins for status transitions', () => {
    const claim = createProviderClaim({
      provider: 'claude',
      taskId: 'del-2',
      subject: 'delegation:del-2',
      predicate: 'reported_result',
      object: 'reviewed architecture',
    }, new Date('2026-05-05T00:00:00.000Z'));

    appendProviderClaim(tmpDir, claim);
    const updated = transitionStoredProviderClaim(
      tmpDir,
      claim.id,
      'verified',
      new Date('2026-05-05T01:00:00.000Z'),
    );

    expect(updated?.status).toBe('verified');
    expect(readProviderClaimsSync(tmpDir, { status: 'verified' })).toEqual([
      expect.objectContaining({
        id: claim.id,
        updatedAt: '2026-05-05T01:00:00.000Z',
      }),
    ]);
    expect(readProviderClaimsSync(tmpDir, { status: 'hypothesis' })).toEqual([]);
  });

  it('summarizes recent claims for shared context', () => {
    appendProviderClaim(tmpDir, createProviderClaim({
      provider: 'akari',
      taskId: 'del-3',
      subject: 'delegation:del-3',
      predicate: 'reported_result',
      object: 'Tanren should act as peer agent with its own adapter',
    }));

    expect(getRecentClaimsSummary(tmpDir)).toContain('[hypothesis] akari reported_result delegation:del-3');
  });
});
