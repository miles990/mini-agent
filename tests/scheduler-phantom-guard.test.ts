/**
 * Scheduler phantom-id guard — GitHub issue #186
 *
 * Verifies that `incrementTaskStaleness` skips task entries that appear in the
 * merged index view (relations.jsonl) but have zero hits in task-events.jsonl.
 *
 * Root cause: tasks must route to the task-events bucket via getBucketForType.
 * If a task-type entry lands in relations.jsonl (test side-effect, manual write,
 * or migration artifact), it is a phantom: no real delegation event was persisted.
 * Such entries must NOT trigger stale-task surfacing; instead they must be dropped
 * and logged as [scheduler] phantom-id-skipped.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendMemoryIndexEntry,
  getTaskEventsPath,
  getMemoryIndexPath,
  getP0TaskPreviews,
  incrementTaskStaleness,
  invalidateIndexCache,
  queryMemoryIndexSync,
} from '../src/memory-index.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phantom-guard-'));
  invalidateIndexCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  invalidateIndexCache();
});

/**
 * Manually inject a phantom task entry directly into relations.jsonl.
 * This simulates a task that somehow bypassed the bucket router and
 * ended up in the wrong file (hypothesis #2 from the issue).
 */
async function injectPhantomIntoRelations(id: string, summary: string): Promise<void> {
  const relationsPath = getMemoryIndexPath(tmpDir);
  const dir = path.dirname(relationsPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const phantom = {
    id,
    ts: new Date().toISOString(),
    type: 'task',
    status: 'pending',
    refs: [],
    summary,
    payload: { priority: 1 },
  };
  fs.appendFileSync(relationsPath, JSON.stringify(phantom) + '\n', 'utf-8');
  invalidateIndexCache();
}

describe('issue #186 — phantom task guard in incrementTaskStaleness', () => {
  it('phantom task in relations.jsonl does not appear in stale list after multiple ticks', async () => {
    const phantomId = 'idx-fail-2avd';
    await injectPhantomIntoRelations(phantomId, 'Update src/agent.ts (phantom)');

    // Verify the phantom is visible in the merged view
    const merged = queryMemoryIndexSync(tmpDir, { type: ['task'], status: ['pending'] });
    expect(merged.some(e => e.id === phantomId)).toBe(true);

    // Verify task-events.jsonl has zero hits for this id
    const taskEventsPath = getTaskEventsPath(tmpDir);
    if (fs.existsSync(taskEventsPath)) {
      const content = fs.readFileSync(taskEventsPath, 'utf-8');
      expect(content).not.toContain(phantomId);
    }

    // Run staleness increment enough times to exceed STALENESS_THRESHOLD (3)
    let staleResult: Awaited<ReturnType<typeof incrementTaskStaleness>> = [];
    for (let i = 0; i < 5; i++) {
      staleResult = await incrementTaskStaleness(tmpDir);
    }

    // Phantom must NOT appear in the stale surfacing list
    expect(staleResult.some(s => s.id === phantomId)).toBe(false);
  });

  it('real task in task-events.jsonl is still surfaced as stale', async () => {
    const real = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'real task that can go stale',
      payload: { priority: 2 },
    });

    // Verify it landed in task-events.jsonl
    const taskEventsPath = getTaskEventsPath(tmpDir);
    expect(fs.existsSync(taskEventsPath)).toBe(true);
    expect(fs.readFileSync(taskEventsPath, 'utf-8')).toContain(real.id);

    // Run enough ticks to exceed STALENESS_THRESHOLD (>3 ticks needed)
    let staleResult: Awaited<ReturnType<typeof incrementTaskStaleness>> = [];
    for (let i = 0; i < 5; i++) {
      staleResult = await incrementTaskStaleness(tmpDir);
      invalidateIndexCache();
    }

    expect(staleResult.some(s => s.id === real.id)).toBe(true);
  });

  it('phantom does not accumulate ticksSinceLastProgress in task-events.jsonl', async () => {
    const phantomId = 'idx-phantom-leak-99';
    await injectPhantomIntoRelations(phantomId, 'Phantom leak task');

    // Run multiple staleness increments
    for (let i = 0; i < 4; i++) {
      await incrementTaskStaleness(tmpDir);
      invalidateIndexCache();
    }

    // Phantom should NOT have gained any entries in task-events.jsonl
    const taskEventsPath = getTaskEventsPath(tmpDir);
    if (fs.existsSync(taskEventsPath)) {
      const content = fs.readFileSync(taskEventsPath, 'utf-8');
      expect(content).not.toContain(phantomId);
    }
  });

  it('mixed scenario: phantom skipped, real task surfaced correctly', async () => {
    const phantomId = 'idx-phantom-mixed';
    await injectPhantomIntoRelations(phantomId, 'Phantom in relations only');

    const real = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'legitimate pending task',
      payload: { priority: 1 },
    });

    // Run 5 ticks
    let staleResult: Awaited<ReturnType<typeof incrementTaskStaleness>> = [];
    for (let i = 0; i < 5; i++) {
      staleResult = await incrementTaskStaleness(tmpDir);
      invalidateIndexCache();
    }

    // Only real task in stale list, phantom excluded
    const staleIds = staleResult.map(s => s.id);
    expect(staleIds).toContain(real.id);
    expect(staleIds).not.toContain(phantomId);
  });
});

describe('issue #257 — phantom task guard in getP0TaskPreviews', () => {
  function injectPhantomP0(id: string, summary: string): void {
    const relationsPath = getMemoryIndexPath(tmpDir);
    const dir = path.dirname(relationsPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(relationsPath, JSON.stringify({
      id,
      ts: new Date().toISOString(),
      type: 'task',
      status: 'pending',
      refs: [],
      summary,
      payload: { priority: 0 },
    }) + '\n', 'utf-8');
    invalidateIndexCache();
  }

  it('phantom P0 task in relations.jsonl is excluded from preview list', () => {
    const phantomId = 'task-1778139204128-8c';
    injectPhantomP0(phantomId, 'Decompose middleware task task-1778139204128-8c after max-turns failure');

    // Phantom IS visible in the merged index
    const merged = queryMemoryIndexSync(tmpDir, { type: ['task'], status: ['pending'] });
    expect(merged.some(e => e.id === phantomId)).toBe(true);

    // But getP0TaskPreviews should filter it out
    const previews = getP0TaskPreviews(tmpDir);
    expect(previews.some(p => p.includes(phantomId))).toBe(false);
    expect(previews.some(p => p.includes('max-turns failure'))).toBe(false);
  });

  it('real P0 task in task-events.jsonl still appears in preview list', async () => {
    await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'Critical P0 deployment blocker',
      payload: { priority: 0 },
    });
    invalidateIndexCache();

    const previews = getP0TaskPreviews(tmpDir);
    expect(previews.some(p => p.includes('Critical P0 deployment blocker'))).toBe(true);
  });

  it('phantom P0 excluded while real P0 still shown (mixed scenario)', async () => {
    const phantomId = 'task-1778139697719-8i';
    injectPhantomP0(phantomId, 'Decompose middleware task task-1778139697719-8i after max-turns failure');

    await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'Real P0 incident response',
      payload: { priority: 0 },
    });
    invalidateIndexCache();

    const previews = getP0TaskPreviews(tmpDir);
    expect(previews.some(p => p.includes('Real P0 incident response'))).toBe(true);
    expect(previews.some(p => p.includes(phantomId))).toBe(false);
    expect(previews.some(p => p.includes('max-turns failure'))).toBe(false);
  });
});
