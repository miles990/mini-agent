/**
 * Scheduler dispatch suppression — GitHub issue #196
 *
 * Task 連續 terminal state 應暫停重派:
 * After DISPATCH_SUPPRESSION_THRESHOLD consecutive terminal signals,
 * a task is excluded from the dispatch queue until an external trigger resets it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendMemoryIndexEntry,
  invalidateIndexCache,
} from '../src/memory-index.js';
import {
  schedulerPick,
  recordTaskTerminalSignal,
  resetTaskSuppression,
  resetAllSuppressions,
  isTaskSuppressed,
  getSuppressedTaskIds,
  getTerminalSignalCount,
  DISPATCH_SUPPRESSION_THRESHOLD,
} from '../src/scheduler.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dispatch-suppress-'));
  invalidateIndexCache();
  resetAllSuppressions();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  invalidateIndexCache();
  resetAllSuppressions();
});

// ─── Constants ────────────────────────────────────────────────────────────────

describe('DISPATCH_SUPPRESSION_THRESHOLD', () => {
  it('is exported and equals 3', () => {
    expect(DISPATCH_SUPPRESSION_THRESHOLD).toBe(3);
  });
});

// ─── recordTaskTerminalSignal ─────────────────────────────────────────────────

describe('recordTaskTerminalSignal', () => {
  it('increments terminal signal count', () => {
    recordTaskTerminalSignal('task-a');
    expect(getTerminalSignalCount('task-a')).toBe(1);
    recordTaskTerminalSignal('task-a');
    expect(getTerminalSignalCount('task-a')).toBe(2);
  });

  it('does not suppress before threshold', () => {
    for (let i = 0; i < DISPATCH_SUPPRESSION_THRESHOLD - 1; i++) {
      recordTaskTerminalSignal('task-b');
    }
    expect(isTaskSuppressed('task-b')).toBe(false);
  });

  it('suppresses at threshold', () => {
    for (let i = 0; i < DISPATCH_SUPPRESSION_THRESHOLD; i++) {
      recordTaskTerminalSignal('task-c');
    }
    expect(isTaskSuppressed('task-c')).toBe(true);
  });

  it('does not double-suppress beyond threshold', () => {
    for (let i = 0; i < DISPATCH_SUPPRESSION_THRESHOLD + 5; i++) {
      recordTaskTerminalSignal('task-d');
    }
    expect(isTaskSuppressed('task-d')).toBe(true);
    expect(getSuppressedTaskIds().filter(id => id === 'task-d')).toHaveLength(1);
  });

  it('tracks counts independently per task', () => {
    recordTaskTerminalSignal('task-x');
    recordTaskTerminalSignal('task-x');
    recordTaskTerminalSignal('task-y');
    expect(getTerminalSignalCount('task-x')).toBe(2);
    expect(getTerminalSignalCount('task-y')).toBe(1);
  });
});

// ─── isTaskSuppressed / getSuppressedTaskIds ──────────────────────────────────

describe('isTaskSuppressed', () => {
  it('returns false for unknown task', () => {
    expect(isTaskSuppressed('unknown-task')).toBe(false);
  });

  it('returns false before threshold', () => {
    recordTaskTerminalSignal('task-e');
    expect(isTaskSuppressed('task-e')).toBe(false);
  });

  it('returns true after threshold', () => {
    for (let i = 0; i < DISPATCH_SUPPRESSION_THRESHOLD; i++) {
      recordTaskTerminalSignal('task-f');
    }
    expect(isTaskSuppressed('task-f')).toBe(true);
  });
});

describe('getSuppressedTaskIds', () => {
  it('returns empty array initially', () => {
    expect(getSuppressedTaskIds()).toEqual([]);
  });

  it('lists all suppressed tasks', () => {
    for (let i = 0; i < DISPATCH_SUPPRESSION_THRESHOLD; i++) {
      recordTaskTerminalSignal('t1');
      recordTaskTerminalSignal('t2');
    }
    const ids = getSuppressedTaskIds();
    expect(ids).toContain('t1');
    expect(ids).toContain('t2');
  });
});

// ─── resetTaskSuppression ─────────────────────────────────────────────────────

describe('resetTaskSuppression', () => {
  it('clears suppression state for a task', () => {
    for (let i = 0; i < DISPATCH_SUPPRESSION_THRESHOLD; i++) {
      recordTaskTerminalSignal('task-g');
    }
    expect(isTaskSuppressed('task-g')).toBe(true);
    resetTaskSuppression('task-g');
    expect(isTaskSuppressed('task-g')).toBe(false);
  });

  it('resets signal count so task can be suppressed again', () => {
    for (let i = 0; i < DISPATCH_SUPPRESSION_THRESHOLD; i++) {
      recordTaskTerminalSignal('task-h');
    }
    resetTaskSuppression('task-h');
    expect(getTerminalSignalCount('task-h')).toBe(0);

    // Can suppress again after reset
    for (let i = 0; i < DISPATCH_SUPPRESSION_THRESHOLD; i++) {
      recordTaskTerminalSignal('task-h');
    }
    expect(isTaskSuppressed('task-h')).toBe(true);
  });

  it('is a no-op for tasks that were never recorded', () => {
    expect(() => resetTaskSuppression('task-never')).not.toThrow();
    expect(isTaskSuppressed('task-never')).toBe(false);
  });
});

// ─── resetAllSuppressions ────────────────────────────────────────────────────

describe('resetAllSuppressions', () => {
  it('clears all suppressed tasks', () => {
    for (let i = 0; i < DISPATCH_SUPPRESSION_THRESHOLD; i++) {
      recordTaskTerminalSignal('t1');
      recordTaskTerminalSignal('t2');
    }
    expect(getSuppressedTaskIds().length).toBeGreaterThan(0);
    resetAllSuppressions();
    expect(getSuppressedTaskIds()).toEqual([]);
  });

  it('clears all signal counts', () => {
    recordTaskTerminalSignal('t3');
    resetAllSuppressions();
    expect(getTerminalSignalCount('t3')).toBe(0);
  });

  it('is safe to call when nothing is suppressed', () => {
    expect(() => resetAllSuppressions()).not.toThrow();
  });
});

// ─── schedulerPick integration — suppressed tasks are excluded ────────────────

describe('schedulerPick — suppressed tasks excluded from dispatch', () => {
  it('does not pick a suppressed task', async () => {
    const task = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'P1 task that keeps saying done',
      payload: { priority: 1 },
    });
    invalidateIndexCache();

    // Suppress the task
    for (let i = 0; i < DISPATCH_SUPPRESSION_THRESHOLD; i++) {
      recordTaskTerminalSignal(task.id);
    }
    expect(isTaskSuppressed(task.id)).toBe(true);

    const decision = schedulerPick(tmpDir, []);
    expect(decision.taskId).not.toBe(task.id);
  });

  it('picks the task again after suppression is reset', async () => {
    const task = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'P0 high priority task',
      payload: { priority: 0 },
    });
    invalidateIndexCache();

    // Suppress then reset
    for (let i = 0; i < DISPATCH_SUPPRESSION_THRESHOLD; i++) {
      recordTaskTerminalSignal(task.id);
    }
    resetTaskSuppression(task.id);
    invalidateIndexCache();

    const decision = schedulerPick(tmpDir, []);
    expect(decision.taskId).toBe(task.id);
  });

  it('still picks non-suppressed tasks when some tasks are suppressed', async () => {
    const suppressed = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'P1 stuck task',
      payload: { priority: 1 },
    });
    const active = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'P1 active task',
      payload: { priority: 1 },
    });
    invalidateIndexCache();

    for (let i = 0; i < DISPATCH_SUPPRESSION_THRESHOLD; i++) {
      recordTaskTerminalSignal(suppressed.id);
    }

    const decision = schedulerPick(tmpDir, []);
    expect(decision.taskId).toBe(active.id);
    expect(decision.taskId).not.toBe(suppressed.id);
  });

  it('keeps suppression across routine scheduler events', async () => {
    const task = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'P0 task suppressed by repeated terminal signals',
      payload: { priority: 0 },
    });
    invalidateIndexCache();

    for (let i = 0; i < DISPATCH_SUPPRESSION_THRESHOLD; i++) {
      recordTaskTerminalSignal(task.id);
    }

    const decision = schedulerPick(tmpDir, [{ source: 'heartbeat', priority: 3, isAlexDirectMessage: false }]);

    expect(isTaskSuppressed(task.id)).toBe(true);
    expect(decision.taskId).not.toBe(task.id);
  });

  it('resets suppression on a human-directed scheduler event', async () => {
    const task = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'P0 task revived by Alex message',
      payload: { priority: 0 },
    });
    invalidateIndexCache();

    for (let i = 0; i < DISPATCH_SUPPRESSION_THRESHOLD; i++) {
      recordTaskTerminalSignal(task.id);
    }
    expect(isTaskSuppressed(task.id)).toBe(true);

    const decision = schedulerPick(tmpDir, [{ source: 'room', priority: 0, isAlexDirectMessage: true }]);

    expect(isTaskSuppressed(task.id)).toBe(false);
    expect(getTerminalSignalCount(task.id)).toBe(0);
    expect(decision.taskId).toBe(task.id);
  });
});
