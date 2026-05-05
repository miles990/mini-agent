import { describe, expect, it } from 'vitest';
import { WriteLeaseManager, scopesOverlap } from '../src/write-lease.js';

describe('WriteLeaseManager', () => {
  it('acquires and releases leases', () => {
    const manager = new WriteLeaseManager();
    const lease = manager.acquire({
      taskId: 'task-1',
      holder: 'codex',
      fileScopes: ['src/agent.ts'],
    }, new Date('2026-05-05T00:00:00.000Z'));

    expect(lease.id).toBe('lease-1');
    expect(manager.active(new Date('2026-05-05T00:01:00.000Z'))).toHaveLength(1);
    expect(manager.release(lease.id)).toBe(true);
    expect(manager.active(new Date('2026-05-05T00:02:00.000Z'))).toHaveLength(0);
  });

  it('rejects overlapping file scopes', () => {
    const manager = new WriteLeaseManager();
    manager.acquire({
      taskId: 'task-1',
      holder: 'codex',
      fileScopes: ['src'],
    });

    expect(() => manager.acquire({
      taskId: 'task-2',
      holder: 'claude',
      fileScopes: ['src/agent.ts'],
    })).toThrow(/write lease conflict/);
  });

  it('allows non-overlapping scopes', () => {
    const manager = new WriteLeaseManager();
    manager.acquire({
      taskId: 'task-1',
      holder: 'codex',
      fileScopes: ['src/agent.ts'],
    });

    const lease = manager.acquire({
      taskId: 'task-2',
      holder: 'claude',
      fileScopes: ['tests/agent.test.ts'],
    });
    expect(lease.id).toBe('lease-2');
  });

  it('expires old leases', () => {
    const manager = new WriteLeaseManager();
    manager.acquire({
      taskId: 'task-1',
      holder: 'codex',
      fileScopes: ['src'],
      ttlMs: 1000,
    }, new Date('2026-05-05T00:00:00.000Z'));

    expect(manager.active(new Date('2026-05-05T00:00:02.000Z'))).toHaveLength(0);
  });
});

describe('scopesOverlap', () => {
  it('detects exact and ancestor overlaps', () => {
    expect(scopesOverlap(['src'], ['src/agent.ts'])).toBe(true);
    expect(scopesOverlap(['src/agent.ts'], ['src/agent.ts'])).toBe(true);
  });

  it('does not overlap sibling paths', () => {
    expect(scopesOverlap(['src/agent.ts'], ['src/agent.test.ts'])).toBe(false);
    expect(scopesOverlap(['src/agent.ts'], ['tests/agent.test.ts'])).toBe(false);
  });
});
