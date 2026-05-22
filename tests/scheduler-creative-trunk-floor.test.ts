/**
 * Scheduler creative-trunk fairness floor.
 *
 * The discovery slot is a primary track of being, co-equal with the task
 * queue. It used to fire only when no task was bound, so a standing P0 *task*
 * (e.g. a never-closing "[output-gate] produce external-facing output"
 * correction) won `continue current` every cycle and starved the creative
 * trunk indefinitely.
 *
 * These tests pin the fix: every DISCOVERY_INTERVAL ticks the discovery slot
 * fires even while a P0 task is bound — but a live P0 *event* still owns its
 * cycle, and on non-discovery ticks the task binding is unchanged.
 */

import { describe, it, expect } from 'vitest';
import { DefaultScheduler, type TaskSnapshot, type SchedulerState, type IncomingEvent } from '../src/scheduler.js';

function p0Task(id: string): TaskSnapshot {
  return {
    id,
    summary: '[output-gate] produce external-facing output',
    status: 'in_progress',
    priority: 0,
    source: 'system',
    createdAt: new Date().toISOString(),
    ticksSpent: 5,
    deadline: null,
    dependsOn: [],
  };
}

function state(overrides: Partial<SchedulerState> = {}): SchedulerState {
  return { currentTaskId: 'task-p0', ticksOnCurrent: 3, totalTicks: 10, lastDiscoveryTick: 0, ...overrides };
}

const noEvents: IncomingEvent[] = [];

describe('scheduler creative-trunk fairness floor', () => {
  it('fires the discovery slot every DISCOVERY_INTERVAL ticks even while a P0 task is bound', () => {
    const scheduler = new DefaultScheduler();
    // tick 10 is a discovery slot; a P0 task is bound as currentTaskId.
    const decision = scheduler.decideNext([p0Task('task-p0')], state({ totalTicks: 10 }), noEvents);

    expect(decision.action).toBe('discovery');
    expect(decision.reason.toLowerCase()).toContain('creative trunk');
    // The bound task is not dropped — taskId is null so currentTaskId persists
    // and the task resumes on the next tick.
    expect(decision.taskId).toBeNull();
  });

  it('a live P0 event still owns its cycle — the floor does not steal it', () => {
    const scheduler = new DefaultScheduler();
    const p0Event: IncomingEvent[] = [{ source: 'room', priority: 0, isAlexDirectMessage: true }];
    const decision = scheduler.decideNext([p0Task('task-p0')], state({ totalTicks: 10 }), p0Event);

    expect(decision.action).not.toBe('discovery');
  });

  it('on a non-discovery tick the bound task continues as normal', () => {
    const scheduler = new DefaultScheduler();
    const decision = scheduler.decideNext([p0Task('task-p0')], state({ totalTicks: 11 }), noEvents);

    expect(decision.action).toBe('continue');
    expect(decision.taskId).toBe('task-p0');
  });
});
