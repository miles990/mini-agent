import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  classifyKgDiscussions,
  readKgDiscussionLifecycleRecords,
} from '../src/kg-discussion-janitor.js';
import { queryMemoryIndexSync } from '../src/memory-index.js';

let memoryDir: string;

beforeEach(() => {
  memoryDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-kg-discussion-'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(memoryDir, { recursive: true, force: true });
});

describe('KG discussion lifecycle janitor', () => {
  it('queues stale open discussions as explicit close-or-refresh tasks', async () => {
    const result = await classifyKgDiscussions(memoryDir, [{
      id: 'disc-old',
      topic: 'agent coordination stale topic',
      status: 'open',
      position_count: 2,
      updated_at: '2026-04-25T00:00:00.000Z',
    }], new Date('2026-05-07T00:00:00.000Z'));

    expect(result).toEqual({ scanned: 1, stale: 1, closed: 0, queued: 1, skippedKnown: 0 });
    expect(readKgDiscussionLifecycleRecords(memoryDir)[0]).toEqual(expect.objectContaining({
      discussionId: 'disc-old',
      bucket: 'stale-discussion',
      followUpTaskId: expect.any(String),
    }));
    expect(queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending'] })[0]).toEqual(expect.objectContaining({
      summary: expect.stringContaining('close or refresh'),
      tags: expect.arrayContaining(['kg', 'discussion-lifecycle', 'stale-discussion']),
      payload: expect.objectContaining({ priority: 2 }),
    }));
  });

  it('is idempotent once a stale discussion has a lifecycle record', async () => {
    const discussion = {
      id: 'disc-room',
      namespace: 'kuro',
      topic: 'room-2026-05-01',
      status: 'open',
      position_count: 0,
      updated_at: '2026-05-01T00:00:00.000Z',
    };

    await classifyKgDiscussions(memoryDir, [discussion], new Date('2026-05-07T00:00:00.000Z'));
    const second = await classifyKgDiscussions(memoryDir, [discussion], new Date('2026-05-07T01:00:00.000Z'));

    expect(second).toEqual({ scanned: 1, stale: 1, closed: 0, queued: 0, skippedKnown: 1 });
    expect(queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending'] })).toHaveLength(1);
  });

  it('caps queued lifecycle tasks per sweep to avoid flooding Kuro', async () => {
    const discussions = Array.from({ length: 8 }, (_, index) => ({
      id: `disc-${index}`,
      topic: `stale topic ${index}`,
      status: 'open',
      position_count: 1,
      updated_at: '2026-04-25T00:00:00.000Z',
    }));

    const result = await classifyKgDiscussions(memoryDir, discussions, new Date('2026-05-07T00:00:00.000Z'), {
      maxQueuedPerSweep: 3,
      maxActiveLifecycleTasks: 8,
    });

    expect(result).toEqual({ scanned: 8, stale: 8, closed: 0, queued: 3, skippedKnown: 0 });
    expect(queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending'] })).toHaveLength(3);
  });

  it('does not queue more lifecycle tasks when the active maintenance lane is full', async () => {
    const discussions = Array.from({ length: 4 }, (_, index) => ({
      id: `disc-${index}`,
      topic: `stale topic ${index}`,
      status: 'open',
      position_count: 1,
      updated_at: '2026-04-25T00:00:00.000Z',
    }));

    const first = await classifyKgDiscussions(memoryDir, discussions.slice(0, 2), new Date('2026-05-07T00:00:00.000Z'), {
      maxActiveLifecycleTasks: 2,
    });
    const second = await classifyKgDiscussions(memoryDir, discussions.slice(2), new Date('2026-05-07T01:00:00.000Z'), {
      maxActiveLifecycleTasks: 2,
    });

    expect(first.queued).toBe(2);
    expect(second).toEqual({ scanned: 2, stale: 2, closed: 0, queued: 0, skippedKnown: 0 });
    expect(queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending'] })).toHaveLength(2);
  });

  it('moves excess existing lifecycle tasks to hold during rebalance', async () => {
    const discussions = Array.from({ length: 3 }, (_, index) => ({
      id: `disc-${index}`,
      topic: `stale topic ${index}`,
      status: 'open',
      position_count: 1,
      updated_at: '2026-04-25T00:00:00.000Z',
    }));

    await classifyKgDiscussions(memoryDir, discussions, new Date('2026-05-07T00:00:00.000Z'), {
      maxActiveLifecycleTasks: 3,
    });
    await classifyKgDiscussions(memoryDir, [], new Date('2026-05-07T01:00:00.000Z'), {
      maxActiveLifecycleTasks: 1,
    });

    expect(queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending'] })).toHaveLength(1);
    const held = queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['hold'] });
    expect(held).toHaveLength(2);
    expect(held[0].payload).toEqual(expect.objectContaining({
      priority: 2,
      hold_reason: expect.stringContaining('maintenance lane capped'),
    }));
  });

  it('auto-closes stale Kuro room discussions instead of queueing manual lifecycle tasks', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'closed' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await classifyKgDiscussions(memoryDir, [{
      id: 'room-disc',
      namespace: 'kuro',
      topic: 'room-2026-05-01',
      status: 'open',
      position_count: 2,
      updated_at: '2026-05-01T00:00:00.000Z',
    }], new Date('2026-05-08T00:00:00.000Z'), {
      kgUrl: 'http://kg.test',
    });

    expect(result).toEqual({ scanned: 1, stale: 1, closed: 1, queued: 0, skippedKnown: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://kg.test/api/discussion/room-disc/close',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('source_agent'),
      }),
    );
    expect(readKgDiscussionLifecycleRecords(memoryDir)[0]).toEqual(expect.objectContaining({
      discussionId: 'room-disc',
      bucket: 'stale-room',
      followUpTaskId: 'auto-closed',
    }));
    expect(queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending'] })).toHaveLength(0);
  });
});
