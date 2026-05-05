import { afterEach, describe, expect, it } from 'vitest';

import {
  clearProcessTable,
  getProcessTableSnapshot,
  registerProcess,
  syncFromTasks,
} from '../src/process-table.js';
import type { TaskSnapshot } from '../src/scheduler.js';

afterEach(() => {
  clearProcessTable();
});

function task(id: string, status: string = 'pending'): TaskSnapshot {
  return {
    id,
    summary: `task ${id}`,
    status,
    priority: 1,
    source: 'system',
    createdAt: '2026-05-05T00:00:00.000Z',
    ticksSpent: 0,
    deadline: null,
    dependsOn: [],
  };
}

describe('process table sync', () => {
  it('marks missing tasks completed when memory-index reports terminal completion', () => {
    registerProcess(task('idx-done', 'in_progress'));
    syncFromTasks([], null, new Set(['idx-done']));

    expect(getProcessTableSnapshot()).toEqual([
      expect.objectContaining({
        taskId: 'idx-done',
        state: 'completed',
      }),
    ]);
  });

  it('marks missing tasks abandoned when no terminal completion evidence exists', () => {
    registerProcess(task('idx-missing', 'in_progress'));
    syncFromTasks([], null, new Set());

    expect(getProcessTableSnapshot()).toEqual([
      expect.objectContaining({
        taskId: 'idx-missing',
        state: 'abandoned',
      }),
    ]);
  });
});
