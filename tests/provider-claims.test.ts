import { describe, expect, it } from 'vitest';
import {
  claimToKgRecord,
  createProviderClaim,
  transitionClaimStatus,
} from '../src/provider-claims.js';

describe('ProviderClaim', () => {
  it('creates hypothesis claims with provenance', () => {
    const claim = createProviderClaim({
      provider: 'codex',
      taskId: 'task-1',
      subject: 'src/agent.ts',
      predicate: 'depends_on',
      object: 'Claude SDK path',
      evidence: ['rg result'],
      confidence: 0.8,
    }, new Date('2026-05-05T00:00:00.000Z'));

    expect(claim.status).toBe('hypothesis');
    expect(claim.provider).toBe('codex');
    expect(claim.evidence).toEqual(['rg result']);
    expect(claim.createdAt).toBe('2026-05-05T00:00:00.000Z');
  });

  it('transitions hypothesis to verified', () => {
    const claim = createProviderClaim({
      provider: 'claude',
      taskId: 'task-1',
      subject: 'BrainArbiter',
      predicate: 'reduces',
      object: 'provider selection scatter',
    });

    const updated = transitionClaimStatus(claim, 'verified', new Date('2026-05-05T01:00:00.000Z'));
    expect(updated.status).toBe('verified');
    expect(updated.updatedAt).toBe('2026-05-05T01:00:00.000Z');
  });

  it('rejects invalid terminal transitions', () => {
    const claim = createProviderClaim({
      provider: 'akari',
      taskId: 'task-1',
      subject: 'plan',
      predicate: 'has_risk',
      object: 'overdesign',
    });
    const superseded = transitionClaimStatus(claim, 'superseded');
    expect(() => transitionClaimStatus(superseded, 'verified')).toThrow(/invalid claim transition/);
  });

  it('serializes to KG record shape', () => {
    const claim = createProviderClaim({
      provider: 'kuro',
      taskId: 'task-1',
      subject: 'KG',
      predicate: 'stores',
      object: 'claims',
    });

    expect(claimToKgRecord(claim)).toEqual(expect.objectContaining({
      type: 'provider_claim',
      provider: 'kuro',
      task_id: 'task-1',
      status: 'hypothesis',
    }));
  });
});
