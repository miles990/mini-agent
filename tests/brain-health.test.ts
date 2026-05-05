import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getCachedAvailableBrainActors,
  getCachedBrainHealthSnapshot,
  isBrainRuntimeDelegationEnabled,
  refreshBrainHealth,
} from '../src/brain-health.js';
import type { BrainProvider, ProviderId } from '../src/brain-types.js';

const originalFlag = process.env.MINI_AGENT_DELEGATION_RUNTIME;

afterEach(() => {
  if (originalFlag === undefined) delete process.env.MINI_AGENT_DELEGATION_RUNTIME;
  else process.env.MINI_AGENT_DELEGATION_RUNTIME = originalFlag;
});

function provider(id: ProviderId, available: boolean): BrainProvider {
  return {
    id,
    capabilities: {
      canWrite: id === 'codex',
      canUseShell: id === 'shell',
      canUseMcp: false,
      bestFor: ['code'],
    },
    run: vi.fn(),
    abort: vi.fn(),
    health: vi.fn(async () => ({
      available,
      detail: available ? `${id} ok` : `${id} down`,
    })),
  };
}

describe('brain health registry', () => {
  it('starts with an optimistic cached actor set before refresh', () => {
    expect(getCachedBrainHealthSnapshot().checkedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(getCachedAvailableBrainActors()).toEqual(expect.arrayContaining(['claude', 'codex', 'shell']));
  });

  it('refreshes provider health and keeps built-in actors available', async () => {
    const snapshot = await refreshBrainHealth([
      provider('claude', true),
      provider('codex', false),
      provider('shell', true),
    ], [], new Date('2026-05-05T00:00:00.000Z'));

    expect(snapshot.availableActors).toEqual(['claude', 'shell', 'kuro', 'human']);
    expect(snapshot.actors).toEqual(expect.arrayContaining([
      expect.objectContaining({ actor: 'codex', available: false, detail: 'codex down' }),
      expect.objectContaining({ actor: 'human', available: true, kind: 'built-in' }),
    ]));
    expect(getCachedAvailableBrainActors()).toEqual(['claude', 'shell', 'kuro', 'human']);
  });

  it('reads the runtime delegation feature flag consistently', () => {
    process.env.MINI_AGENT_DELEGATION_RUNTIME = 'true';
    expect(isBrainRuntimeDelegationEnabled()).toBe(true);
    process.env.MINI_AGENT_DELEGATION_RUNTIME = '1';
    expect(isBrainRuntimeDelegationEnabled()).toBe(true);
    process.env.MINI_AGENT_DELEGATION_RUNTIME = 'false';
    expect(isBrainRuntimeDelegationEnabled()).toBe(false);
  });
});
