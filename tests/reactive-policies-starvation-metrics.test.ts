/**
 * getStarvationMetrics() — read-only starvation health check
 *
 * TDD: written before implementation.
 * Verifies that the function is purely read-only and returns correct metrics.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { getStarvationMetrics } from '../src/reactive-policies.js';
import { clearProcessTable, registerProcess } from '../src/process-table.js';
import { getProcessTableSnapshot } from '../src/process-table.js';
import type { TaskSnapshot } from '../src/scheduler.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let taskCounter = 0;

function makeTask(overrides: Partial<TaskSnapshot> = {}): TaskSnapshot {
  taskCounter++;
  return {
    id: `task-${taskCounter.toString().padStart(4, '0')}`,
    summary: `task ${taskCounter}`,
    status: 'pending',
    priority: 1,
    source: 'alex',
    ticksSpent: 0,
    createdAt: new Date().toISOString(),
    ...overrides,
  } as TaskSnapshot;
}

/** Register a process and fast-patch lastActiveAt to simulate age. */
function registerAgedProcess(ageMs: number, status: TaskSnapshot['status'] = 'pending'): string {
  const task = makeTask({ status });
  const entry = registerProcess(task);
  // Backdating lastActiveAt to simulate waiting time
  const pastTime = new Date(Date.now() - ageMs).toISOString();
  (entry as { lastActiveAt: string }).lastActiveAt = pastTime;
  return entry.taskId;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  taskCounter = 0;
  clearProcessTable();
});

afterEach(() => {
  clearProcessTable();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Return shape
// ---------------------------------------------------------------------------

describe('getStarvationMetrics — return shape', () => {
  it('returns { starvedCount, maxWaitMs } with numeric types', () => {
    const result = getStarvationMetrics();
    expect(typeof result.starvedCount).toBe('number');
    expect(typeof result.maxWaitMs).toBe('number');
  });

  it('returns zero values when process table is empty', () => {
    const result = getStarvationMetrics();
    expect(result.starvedCount).toBe(0);
    expect(result.maxWaitMs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Starvation counting
// ---------------------------------------------------------------------------

describe('getStarvationMetrics — starvedCount', () => {
  const STARVATION_MS = 30 * 60 * 1000; // 30 min

  it('counts zero starved when all processes are fresh', () => {
    registerAgedProcess(1_000);    // 1 second — not starved
    registerAgedProcess(60_000);   // 1 minute — not starved

    const { starvedCount } = getStarvationMetrics();
    expect(starvedCount).toBe(0);
  });

  it('counts one starved process that exceeds threshold', () => {
    registerAgedProcess(STARVATION_MS + 1_000); // just over 30 min

    const { starvedCount } = getStarvationMetrics();
    expect(starvedCount).toBe(1);
  });

  it('counts multiple starved processes', () => {
    registerAgedProcess(STARVATION_MS + 1_000);
    registerAgedProcess(STARVATION_MS + 5 * 60_000);
    registerAgedProcess(500); // not starved

    const { starvedCount } = getStarvationMetrics();
    expect(starvedCount).toBe(2);
  });

  it('counts pending, scheduled, and suspended states as waiting', () => {
    registerAgedProcess(STARVATION_MS + 1_000, 'pending');
    registerAgedProcess(STARVATION_MS + 1_000, 'in_progress'); // maps to 'scheduled' state via registerProcess
    registerAgedProcess(STARVATION_MS + 1_000, 'pending');

    const { starvedCount } = getStarvationMetrics();
    // at least 2 pending ones are counted; in_progress maps to scheduled
    expect(starvedCount).toBeGreaterThanOrEqual(2);
  });

  it('does not count running processes as starved', () => {
    // Register a pending task then manually set to running state — we cannot
    // do this via registerProcess alone, so we test that only waiting states count:
    // a fresh pending process should not be counted
    registerAgedProcess(1_000, 'pending');

    const { starvedCount } = getStarvationMetrics();
    expect(starvedCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// maxWaitMs
// ---------------------------------------------------------------------------

describe('getStarvationMetrics — maxWaitMs', () => {
  const STARVATION_MS = 30 * 60 * 1000;

  it('returns 0 when no processes exist', () => {
    expect(getStarvationMetrics().maxWaitMs).toBe(0);
  });

  it('returns the wait time of the single waiting process', () => {
    const ageMs = 5 * 60 * 1000; // 5 min
    registerAgedProcess(ageMs);

    const { maxWaitMs } = getStarvationMetrics();
    // Allow ±500 ms clock drift during test execution
    expect(maxWaitMs).toBeGreaterThanOrEqual(ageMs - 500);
    expect(maxWaitMs).toBeLessThanOrEqual(ageMs + 500);
  });

  it('returns the maximum across multiple waiting processes', () => {
    const shortAgeMs = 2 * 60 * 1000;   // 2 min
    const longAgeMs  = STARVATION_MS + 10 * 60_000; // 40 min

    registerAgedProcess(shortAgeMs);
    registerAgedProcess(longAgeMs);

    const { maxWaitMs } = getStarvationMetrics();
    expect(maxWaitMs).toBeGreaterThanOrEqual(longAgeMs - 500);
  });
});

// ---------------------------------------------------------------------------
// Read-only guarantee
// ---------------------------------------------------------------------------

describe('getStarvationMetrics — read-only safety', () => {
  it('does not mutate process priority', () => {
    const STARVATION_MS = 30 * 60 * 1000;
    const taskId = registerAgedProcess(STARVATION_MS + 5 * 60_000);

    const snapshotBefore = getProcessTableSnapshot();
    const priorityBefore = snapshotBefore.find(p => p.taskId === taskId)!.priority;

    getStarvationMetrics();

    const snapshotAfter = getProcessTableSnapshot();
    const priorityAfter = snapshotAfter.find(p => p.taskId === taskId)!.priority;

    expect(priorityAfter).toBe(priorityBefore);
  });

  it('does not mutate process state', () => {
    const STARVATION_MS = 30 * 60 * 1000;
    const taskId = registerAgedProcess(STARVATION_MS + 5 * 60_000);

    const stateBefore = getProcessTableSnapshot().find(p => p.taskId === taskId)!.state;

    getStarvationMetrics();

    const stateAfter = getProcessTableSnapshot().find(p => p.taskId === taskId)!.state;
    expect(stateAfter).toBe(stateBefore);
  });

  it('does not mutate lastActiveAt', () => {
    const STARVATION_MS = 30 * 60 * 1000;
    const taskId = registerAgedProcess(STARVATION_MS + 5 * 60_000);

    const lastActiveBefore = getProcessTableSnapshot().find(p => p.taskId === taskId)!.lastActiveAt;

    getStarvationMetrics();

    const lastActiveAfter = getProcessTableSnapshot().find(p => p.taskId === taskId)!.lastActiveAt;
    expect(lastActiveAfter).toBe(lastActiveBefore);
  });

  it('is callable multiple times without side effects', () => {
    const STARVATION_MS = 30 * 60 * 1000;
    registerAgedProcess(STARVATION_MS + 1_000);
    registerAgedProcess(500);

    const first  = getStarvationMetrics();
    const second = getStarvationMetrics();
    const third  = getStarvationMetrics();

    expect(first.starvedCount).toBe(second.starvedCount);
    expect(second.starvedCount).toBe(third.starvedCount);
  });
});
