import { describe, expect, it } from 'vitest';
import {
  buildObservationHoldPayload,
  detectConfirmedHoldSignal,
  shouldUseCodeProbeForObservation,
} from '../src/observation-efficiency.js';
import type { MemoryIndexEntry } from '../src/memory-index.js';

function task(overrides: Partial<MemoryIndexEntry> = {}): MemoryIndexEntry {
  return {
    id: 'task-1',
    ts: '2026-05-08T00:00:00.000Z',
    type: 'task',
    status: 'pending',
    summary: 'waiting for Alex UI review',
    tags: [],
    payload: { priority: 0 },
    ...overrides,
  } as MemoryIndexEntry;
}

describe('observation efficiency', () => {
  it('detects confirmed user/review holds from previous action text', () => {
    expect(detectConfirmedHoldSignal('Different task is awaiting Alex UI review before continuing')?.kind)
      .toBe('waiting-user');
  });

  it('parks routine confirmed holds and reallocates LLM budget', () => {
    const currentTask = task();
    const decision = shouldUseCodeProbeForObservation({
      decision: { taskId: currentTask.id, reason: currentTask.summary, action: 'continue', suspended: null },
      currentTask,
      allTasks: [currentTask],
      events: [{ source: 'heartbeat', priority: 3, isAlexDirectMessage: false }],
      lastAction: 'This task is awaiting Alex UI review; pick different unblocked work.',
      hasPendingForegroundDelegations: false,
      now: new Date('2026-05-08T00:00:00.000Z'),
    });

    expect(decision.action).toBe('hold-and-reallocate');
    expect(decision.signal?.kind).toBe('waiting-user');
    expect(decision.recheckAt).toBe('2026-05-08T02:00:00.000Z');
  });

  it('does not fast-exit direct user messages', () => {
    const currentTask = task();
    const decision = shouldUseCodeProbeForObservation({
      decision: { taskId: currentTask.id, reason: currentTask.summary, action: 'continue', suspended: null },
      currentTask,
      allTasks: [currentTask],
      events: [{ source: 'telegram', priority: 0, isAlexDirectMessage: true }],
      lastAction: 'This task is awaiting Alex UI review.',
      hasPendingForegroundDelegations: false,
    });

    expect(decision.action).toBe('reason');
  });

  it('keeps reasoning when foreground delegation output may need absorption', () => {
    const currentTask = task();
    const decision = shouldUseCodeProbeForObservation({
      decision: { taskId: currentTask.id, reason: currentTask.summary, action: 'continue', suspended: null },
      currentTask,
      allTasks: [currentTask],
      events: [{ source: 'heartbeat', priority: 3, isAlexDirectMessage: false }],
      lastAction: 'This task is awaiting Alex UI review.',
      hasPendingForegroundDelegations: true,
    });

    expect(decision.action).toBe('reason');
  });

  it('builds scheduler-compatible hold payload without dropping existing payload', () => {
    const currentTask = task({ payload: { priority: 1, source: 'alex' } });
    const payload = buildObservationHoldPayload(currentTask, {
      action: 'hold-and-reallocate',
      reason: 'confirmed hold',
      signal: { kind: 'already-observed', reason: 'same state' },
      recheckAt: '2026-05-08T00:30:00.000Z',
    });

    expect(payload.priority).toBe(1);
    expect(payload.source).toBe('alex');
    expect(payload.holdCondition).toEqual({
      type: 'date-after',
      value: '2026-05-08T00:30:00.000Z',
    });
    expect(payload.observation_efficiency_hold).toMatchObject({
      kind: 'already-observed',
      reason: 'confirmed hold',
    });
  });
});
