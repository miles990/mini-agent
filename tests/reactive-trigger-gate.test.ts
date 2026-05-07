import { describe, expect, it } from 'vitest';
import { ReactiveTriggerGate, extractTriggerPath, parseReactiveTriggerSource, type ReactiveTriggerProbe } from '../src/reactive-trigger-gate.js';

function probe(overrides: Partial<ReactiveTriggerProbe> = {}): ReactiveTriggerProbe {
  return {
    source: 'workspace',
    nowMs: Date.parse('2026-05-07T00:00:00.000Z'),
    perceptionChanged: true,
    pendingHighPriority: 0,
    pendingInbox: 0,
    pendingDelegationResults: false,
    pendingPriority: false,
    lastAction: 'no action',
    trueNoopStreak: 1,
    ...overrides,
  };
}

describe('ReactiveTriggerGate', () => {
  it('debounces repeated workspace noise by path without a full context cycle', () => {
    const gate = new ReactiveTriggerGate({
      workspaceCooldownMs: 5 * 60_000,
      estimatedContextChars: 25_000,
    });

    expect(gate.decide(probe({ path: 'memory/handoffs/active.md' }))).toEqual(expect.objectContaining({
      action: 'wake',
      reason: 'workspace-probe:memory/handoffs/active.md',
    }));
    expect(gate.decide(probe({
      path: 'memory/handoffs/active.md',
      nowMs: Date.parse('2026-05-07T00:01:00.000Z'),
    }))).toEqual(expect.objectContaining({
      action: 'skip',
      reason: 'workspace-cooldown:memory/handoffs/active.md',
      savedContextChars: 25_000,
    }));

    expect(gate.getMetrics()).toEqual(expect.objectContaining({
      skipped: 1,
      woken: 1,
      savedContextChars: 25_000,
    }));
  });

  it('lets workspace wake immediately when the lightweight probe sees real work', () => {
    const gate = new ReactiveTriggerGate({ workspaceCooldownMs: 5 * 60_000 });
    gate.decide(probe({ path: 'memory/handoffs/active.md' }));

    const decision = gate.decide(probe({
      path: 'memory/handoffs/active.md',
      nowMs: Date.parse('2026-05-07T00:01:00.000Z'),
      pendingHighPriority: 1,
      trueNoopStreak: 0,
    }));

    expect(decision).toEqual(expect.objectContaining({
      action: 'wake',
      reason: 'probe:high-priority-work',
    }));
  });

  it('never gates direct messages, alerts, or delegation completions', () => {
    const gate = new ReactiveTriggerGate({ workspaceCooldownMs: 5 * 60_000 });

    for (const source of ['telegram', 'room', 'chat', 'alert', 'delegation-complete', 'delegation-batch', 'continuation'] as const) {
      expect(gate.decide(probe({ source }))).toEqual(expect.objectContaining({
        action: 'wake',
        reason: `bypass:${source}`,
      }));
    }
  });

  it('skips idle heartbeat probes and records estimated context savings', () => {
    const gate = new ReactiveTriggerGate({
      heartbeatIdleCooldownMs: 5 * 60_000,
      estimatedContextChars: 30_000,
    });

    expect(gate.decide(probe({
      source: 'heartbeat',
      perceptionChanged: false,
      lastAction: 'nothing to do',
      trueNoopStreak: 2,
    }))).toEqual(expect.objectContaining({
      action: 'skip',
      reason: 'heartbeat-idle-probe',
      savedContextChars: 30_000,
    }));

    expect(gate.getMetrics().savedContextChars).toBe(30_000);
  });

  it('allows periodic heartbeat scout after the idle cooldown', () => {
    const gate = new ReactiveTriggerGate({
      heartbeatIdleCooldownMs: 5 * 60_000,
      estimatedContextChars: 30_000,
    });
    gate.decide(probe({
      source: 'heartbeat',
      perceptionChanged: false,
      lastAction: 'nothing to do',
      nowMs: Date.parse('2026-05-07T00:00:00.000Z'),
    }));

    expect(gate.decide(probe({
      source: 'heartbeat',
      perceptionChanged: false,
      lastAction: 'nothing to do',
      nowMs: Date.parse('2026-05-07T00:06:00.000Z'),
    }))).toEqual(expect.objectContaining({
      action: 'wake',
      reason: 'heartbeat-periodic-scout',
    }));
  });

  it('parses trigger reasons used by AgentLoop', () => {
    expect(parseReactiveTriggerSource('workspace: {"source":"sentinel","path":"memory/handoffs/active.md"}')).toBe('workspace');
    expect(parseReactiveTriggerSource('heartbeat')).toBe('heartbeat');
    expect(parseReactiveTriggerSource('telegram-user (inbox-recovery)')).toBe('telegram');
    expect(parseReactiveTriggerSource('delegation-batch(3)')).toBe('delegation-batch');
    expect(extractTriggerPath('workspace: {"source":"sentinel","path":"memory/handoffs/active.md"}')).toBe('memory/handoffs/active.md');
  });
});
