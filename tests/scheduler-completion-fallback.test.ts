import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  appendMemoryIndexEntry,
  markTaskDoneById,
  queryMemoryIndexSync,
} from '../src/memory-index.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-scheduler-completion-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('scheduler completion fallback', () => {
  it('writes completed status to task-events when the current scheduler task is done by id', async () => {
    const task = await appendMemoryIndexEntry(tmpDir, {
      id: 'idx-current',
      type: 'task',
      status: 'pending',
      summary: 'P1 current scheduler task',
      refs: [],
      payload: { priority: 1 },
    });

    const marked = await markTaskDoneById(tmpDir, task.id, 'test fallback');

    expect(marked).toBe(true);
    expect(queryMemoryIndexSync(tmpDir, { id: task.id })[0]).toEqual(expect.objectContaining({
      status: 'completed',
      payload: expect.objectContaining({
        completed_by: 'test fallback',
        completed_at: expect.any(String),
      }),
    }));
    expect(queryMemoryIndexSync(tmpDir, {
      type: ['task'],
      status: ['pending', 'in_progress'],
    }).map(t => t.id)).not.toContain(task.id);
  });

  it('is a no-op when the task is already terminal', async () => {
    const task = await appendMemoryIndexEntry(tmpDir, {
      id: 'idx-completed',
      type: 'task',
      status: 'completed',
      summary: 'P1 already completed task',
      refs: [],
    });

    await expect(markTaskDoneById(tmpDir, task.id)).resolves.toBe(false);
    expect(queryMemoryIndexSync(tmpDir, { id: task.id })[0].status).toBe('completed');
  });
});
