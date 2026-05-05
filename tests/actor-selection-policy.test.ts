import { describe, expect, it } from 'vitest';
import { pickActorForRole, pickActorsForRole, rankActorsForRole } from '../src/actor-selection-policy.js';
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

describe('actor selection policy', () => {
  it('selects Codex as primary for code work', () => {
    const actor = pickActorForRole(work({ intent: 'code', risk: 'workspace_write' }), 'primary');
    expect(actor).toBe('codex');
  });

  it('selects Claude as primary and Codex as reviewer for review work', () => {
    const item = work({ intent: 'review' });
    expect(pickActorForRole(item, 'primary')).toBe('claude');
    expect(pickActorsForRole(item, 'reviewer', { exclude: ['claude'] })).toEqual(['codex']);
  });

  it('selects shell for deterministic verification', () => {
    expect(pickActorForRole(work({ intent: 'verify' }), 'executor')).toBe('shell');
  });

  it('ranks Akari as advisor for architecture without treating Tanren as dispatchable', () => {
    const ranked = rankActorsForRole(work({ intent: 'architecture' }), 'advisor');
    expect(ranked[0]).toEqual(expect.objectContaining({
      actor: 'akari',
      reasons: expect.arrayContaining([expect.stringContaining('advisor')]),
    }));
    expect(ranked.map(score => score.actor)).not.toContain('tanren');
  });

  it('includes bounded historical outcome signals in score reasons', () => {
    const ranked = rankActorsForRole(work({ intent: 'review', priority: 'P2' }), 'primary', {
      actorStats: {
        claude: {
          actor: 'claude',
          intent: 'review',
          total: 10,
          success: 9,
          failed: 1,
          skipped: 0,
          successRate: 0.9,
          avgDurationMs: 1500,
          confidence: 1,
          lastFinishedAt: '2026-05-05T00:00:00.000Z',
        },
      },
    });

    expect(ranked.find(score => score.actor === 'claude')?.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining('historical-success:9/10'),
      expect.stringContaining('historical-fast:1500ms'),
    ]));
  });
});
