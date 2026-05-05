import { describe, expect, it } from 'vitest';
import { decideArbitration } from '../src/brain-arbiter.js';
import { deriveConstraintTexture } from '../src/constraint-texture.js';
import type { WorkItem } from '../src/brain-types.js';

function work(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'task-1',
    title: 'Test task',
    intent: 'plan',
    priority: 'P1',
    risk: 'read_only',
    ...overrides,
  };
}

describe('BrainArbiter', () => {
  it('routes deploy and external writes to human approval', () => {
    const decision = decideArbitration(work({ risk: 'deploy', writeScope: ['src/agent.ts'] }));
    expect(decision.mode).toBe('human');
    expect(decision.primary).toBe('human');
    expect(decision.humanApprovalRequired).toBe(true);
    expect(decision.writeLeaseRequired).toBe(true);
    expect(decision.kgClaimsRequired).toBe(true);
  });

  it('routes deterministic verification to shell/local without KG claims', () => {
    const decision = decideArbitration(work({ intent: 'verify' }));
    expect(decision.mode).toBe('solo');
    expect(decision.primary).toBe('shell');
    expect(decision.writeLeaseRequired).toBe(false);
    expect(decision.kgClaimsRequired).toBe(false);
  });

  it('routes workspace coding to Codex with Claude review and write lease', () => {
    const decision = decideArbitration(work({
      intent: 'code',
      risk: 'workspace_write',
      writeScope: ['src/brain-arbiter.ts'],
    }));
    expect(decision.mode).toBe('split');
    expect(decision.primary).toBe('codex');
    expect(decision.reviewers).toEqual(['claude']);
    expect(decision.writeLeaseRequired).toBe(true);
    expect(decision.kgClaimsRequired).toBe(true);
  });

  it('uses Akari panel for architecture work', () => {
    const decision = decideArbitration(work({ intent: 'architecture' }));
    expect(decision.mode).toBe('panel');
    expect(decision.primary).toBe('kuro');
    expect(decision.candidates).toEqual(['akari', 'claude', 'codex']);
    expect(decision.reviewers).toContain('akari');
    expect(decision.reviewers).not.toContain('tanren');
    expect(decision.kgClaimsRequired).toBe(true);
  });

  it('uses consensus when providers already conflict', () => {
    const decision = decideArbitration(work({ hasProviderConflict: true }));
    expect(decision.mode).toBe('consensus');
    expect(decision.candidates).toContain('akari');
  });

  it('falls back cleanly when Codex is unavailable', () => {
    const decision = decideArbitration(
      work({ intent: 'diagnose', risk: 'workspace_write' }),
      { availableActors: ['claude', 'local', 'shell'] },
    );
    expect(decision.primary).toBe('claude');
    expect(decision.mode).toBe('solo');
    expect(decision.reviewers).toEqual([]);
  });

  it('derives reusable constraints for DAG node planning', () => {
    const texture = deriveConstraintTexture(work({
      intent: 'architecture',
      risk: 'workspace_write',
      writeScope: ['src/brain-arbiter.ts'],
      tags: ['kg'],
    }));
    expect(texture.peerCritiqueRequired).toBe(true);
    expect(texture.writeLeaseRequired).toBe(true);
    expect(texture.kgClaimsRequired).toBe(true);
    expect(texture.humanApprovalRequired).toBe(false);
    expect(texture.constraints).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'peer_critique', required: true }),
      expect.objectContaining({ kind: 'write_lease', required: true }),
      expect.objectContaining({ kind: 'provider_claims', required: true }),
    ]));
  });
});
