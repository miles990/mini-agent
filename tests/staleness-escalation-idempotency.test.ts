/**
 * Staleness escalation idempotency — issue #156
 *
 * Verifies that `incrementTaskStaleness` only escalates a task to P0 once,
 * preventing the priority oscillation observed when the OODA loop's stale-task
 * branch unconditionally writes priority=0 every cycle and then upstream syncs
 * (e.g. issue-autopilot, github-issue sync) write the original priority back.
 *
 * Filed-by-and-fixed-by: Kuro / instance 03bbc29a
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  appendMemoryIndexEntry,
  updateMemoryIndexEntry,
  queryMemoryIndexSync,
  incrementTaskStaleness,
  updateTask,
  invalidateIndexCache,
} from '../src/memory-index.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stale-esc-'));
  invalidateIndexCache();
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  invalidateIndexCache();
});

async function bumpTicks(dir: string, n: number) {
  let last: Awaited<ReturnType<typeof incrementTaskStaleness>> = [];
  for (let i = 0; i < n; i++) last = await incrementTaskStaleness(dir);
  return last;
}

function getTask(id: string) {
  return queryMemoryIndexSync(tmpDir, { id, limit: 1 })[0];
}

describe('issue #156 — staleness escalation idempotency', () => {
  it('escalates exactly once and stamps escalated_at', async () => {
    const e = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'sync gh issue 999 → task',
      payload: { priority: 2 },
    });

    // Push past the >5 ticks threshold (6 cycles).
    const stale = await bumpTicks(tmpDir, 6);
    const escalated = stale.find(s => s.id === e.id);
    expect(escalated, 'task should be in stale list after 6 ticks').toBeDefined();
    expect(escalated!.firstEscalation).toBe(true);

    const after = getTask(e.id);
    const payload = after.payload as Record<string, unknown>;
    expect(payload.priority).toBe(0);
    expect(typeof payload.escalated_at).toBe('string');
    const firstStamp = payload.escalated_at as string;

    // One more tick: should NOT re-escalate.
    const stale2 = await incrementTaskStaleness(tmpDir);
    const found2 = stale2.find(s => s.id === e.id);
    expect(found2!.firstEscalation).toBe(false);

    const after2 = getTask(e.id);
    const payload2 = after2.payload as Record<string, unknown>;
    expect(payload2.escalated_at).toBe(firstStamp); // stamp unchanged
  });

  it('clears escalated_at when status transitions (allows re-escalation later)', async () => {
    const e = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'task that gets reopened',
      payload: { priority: 2 },
    });

    // Escalate.
    await bumpTicks(tmpDir, 6);
    expect((getTask(e.id).payload as Record<string, unknown>).escalated_at).toBeTruthy();

    // Status transition resets ticks AND escalation stamp.
    await updateTask(tmpDir, e.id, { status: 'in_progress' });
    const after = getTask(e.id);
    const payload = after.payload as Record<string, unknown>;
    expect(payload.ticksSinceLastProgress).toBe(0);
    expect(payload.escalated_at).toBeUndefined();
  });

  it('does not re-write payload on stale tasks already escalated (no oscillation)', async () => {
    // Simulates the bug: external sync writes priority=2 back; staleness must
    // NOT clobber it again on the next cycle (since we already escalated once).
    const e = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'oscillation candidate',
      payload: { priority: 2 },
    });

    await bumpTicks(tmpDir, 6); // first escalation: priority → 0
    // External sync rewrites priority back to 2.
    await updateMemoryIndexEntry(tmpDir, e.id, {
      payload: { ...(getTask(e.id).payload as Record<string, unknown>), priority: 2 },
    });
    expect((getTask(e.id).payload as Record<string, unknown>).priority).toBe(2);

    // Next staleness tick: must NOT re-escalate (escalated_at already set).
    const stale = await incrementTaskStaleness(tmpDir);
    const found = stale.find(s => s.id === e.id);
    expect(found!.firstEscalation).toBe(false);
    // Priority stays at 2 — no oscillation.
    expect((getTask(e.id).payload as Record<string, unknown>).priority).toBe(2);
  });

  it('does not promote pipeline backlog tasks to P0 by staleness alone', async () => {
    const e = await appendMemoryIndexEntry(tmpDir, {
      type: 'task',
      status: 'pending',
      summary: 'stash-backlog diagnostic',
      payload: { origin: 'pipeline', priority: 1 },
    });

    const stale = await bumpTicks(tmpDir, 6);

    const found = stale.find(s => s.id === e.id);
    expect(found).toEqual(expect.objectContaining({
      id: e.id,
      firstEscalation: false,
    }));
    expect(getTask(e.id).payload).toEqual(expect.objectContaining({
      priority: 1,
      ticksSinceLastProgress: 6,
    }));
    expect((getTask(e.id).payload as Record<string, unknown>).escalated_at).toBeUndefined();
  });
});
