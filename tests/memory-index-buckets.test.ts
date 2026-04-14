/**
 * Memory Index — Phase 3 bucket routing tests
 *
 * Verifies that task entries land in state/task-events.jsonl while
 * commitment/goal/remember entries stay in index/relations.jsonl, and
 * that queries transparently merge both buckets.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendMemoryIndexEntry,
  updateMemoryIndexEntry,
  deleteMemoryIndexEntry,
  queryMemoryIndexSync,
  getMemoryIndexPath,
  getTaskEventsPath,
  invalidateIndexCache,
} from '../src/memory-index.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-idx-bucket-'));
  invalidateIndexCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  invalidateIndexCache();
});

describe('memory-index — bucket routing', () => {
  it('task entries land in state/task-events.jsonl', async () => {
    await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'ship phase 3',
    });

    const taskEventsFile = getTaskEventsPath(tmpDir);
    const relationsFile = getMemoryIndexPath(tmpDir);

    expect(fs.existsSync(taskEventsFile)).toBe(true);
    const teContent = fs.readFileSync(taskEventsFile, 'utf8').trim();
    expect(teContent).toContain('"type":"task"');
    expect(teContent).toContain('ship phase 3');

    // relations.jsonl may exist empty but must not contain the task
    const relContent = fs.existsSync(relationsFile)
      ? fs.readFileSync(relationsFile, 'utf8')
      : '';
    expect(relContent).not.toContain('ship phase 3');
  });

  it('non-task entries stay in relations.jsonl', async () => {
    await appendMemoryIndexEntry(tmpDir, {
      type: 'remember',
      status: 'active',
      topic: 'test',
      summary: 'remember me',
    });
    await appendMemoryIndexEntry(tmpDir, {
      type: 'commitment',
      status: 'active',
      summary: 'i will do x',
    });
    await appendMemoryIndexEntry(tmpDir, {
      type: 'goal',
      status: 'pending',
      summary: 'my goal',
    });

    const relContent = fs.readFileSync(getMemoryIndexPath(tmpDir), 'utf8');
    expect(relContent).toContain('remember me');
    expect(relContent).toContain('i will do x');
    expect(relContent).toContain('my goal');

    // task-events.jsonl must not contain these
    const teFile = getTaskEventsPath(tmpDir);
    const teContent = fs.existsSync(teFile) ? fs.readFileSync(teFile, 'utf8') : '';
    expect(teContent).not.toContain('remember me');
    expect(teContent).not.toContain('i will do x');
    expect(teContent).not.toContain('my goal');
  });

  it('queries merge both buckets transparently', async () => {
    await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'task A',
    });
    await appendMemoryIndexEntry(tmpDir, {
      type: 'remember',
      status: 'active',
      summary: 'memory B',
    });
    await appendMemoryIndexEntry(tmpDir, {
      type: 'goal',
      status: 'pending',
      summary: 'goal C',
    });

    const all = queryMemoryIndexSync(tmpDir, { limit: 100 });
    expect(all).toHaveLength(3);

    const tasks = queryMemoryIndexSync(tmpDir, { type: 'task' });
    expect(tasks).toHaveLength(1);
    expect(tasks[0].summary).toBe('task A');

    const nonTasks = queryMemoryIndexSync(tmpDir, { type: ['remember', 'goal'] });
    expect(nonTasks).toHaveLength(2);
  });

  it('task update appends to task-events.jsonl, not relations', async () => {
    const created = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'task X',
    });

    await updateMemoryIndexEntry(tmpDir, created.id, { status: 'in_progress' });

    const teContent = fs.readFileSync(getTaskEventsPath(tmpDir), 'utf8');
    const lines = teContent.split('\n').filter(l => l.trim());
    expect(lines).toHaveLength(2); // append-only: 2 events for one task
    const latest = JSON.parse(lines[lines.length - 1]);
    expect(latest.status).toBe('in_progress');
    expect(latest.id).toBe(created.id);

    // relations.jsonl unaffected
    const relFile = getMemoryIndexPath(tmpDir);
    const relContent = fs.existsSync(relFile) ? fs.readFileSync(relFile, 'utf8') : '';
    expect(relContent).not.toContain(created.id);
  });

  it('task delete appends tombstone to task-events.jsonl', async () => {
    const created = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'task to delete',
    });

    await deleteMemoryIndexEntry(tmpDir, created.id);

    // query should not return it (toEntryMap handles 'deleted' status)
    const found = queryMemoryIndexSync(tmpDir, { id: created.id });
    expect(found).toHaveLength(0);

    // tombstone in task-events.jsonl
    const teContent = fs.readFileSync(getTaskEventsPath(tmpDir), 'utf8');
    expect(teContent).toContain('"status":"deleted"');
  });

  it('reload from disk reconstructs merged view', async () => {
    await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'task from bucket',
    });
    await appendMemoryIndexEntry(tmpDir, {
      type: 'remember',
      status: 'active',
      summary: 'memory from bucket',
    });

    // Force cache clear — next query reads from disk
    invalidateIndexCache();

    const all = queryMemoryIndexSync(tmpDir, { limit: 100 });
    const summaries = all.map(e => e.summary).sort();
    expect(summaries).toEqual(['memory from bucket', 'task from bucket']);
  });

  it('task updated from non-task type moves bucket on next write', async () => {
    // Edge case: if an entry's type is mutated, subsequent writes route to
    // the new bucket. Existing lines stay in the old bucket (append-only
    // history is honored). Current-state query reflects the latest row.
    const created = await appendMemoryIndexEntry(tmpDir, {
      type: 'remember',
      status: 'active',
      summary: 'entry that changes type',
    });

    const updated = await updateMemoryIndexEntry(tmpDir, created.id, { type: 'task', status: 'pending' });
    expect(updated).not.toBeNull();

    const teContent = fs.readFileSync(getTaskEventsPath(tmpDir), 'utf8');
    expect(teContent).toContain(created.id);
    expect(teContent).toContain('"type":"task"');

    const relContent = fs.readFileSync(getMemoryIndexPath(tmpDir), 'utf8');
    expect(relContent).toContain(created.id);
    expect(relContent).toContain('"type":"remember"');

    // Merged view: latest row wins
    const found = queryMemoryIndexSync(tmpDir, { id: created.id });
    expect(found).toHaveLength(1);
    expect(found[0].type).toBe('task');
  });
});
