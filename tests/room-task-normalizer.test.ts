import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  appendMemoryIndexEntry,
  enqueueRoomDirective,
  pruneNonActionableRoomTasks,
  queryMemoryIndexSync,
} from '../src/memory-index.js';

let memoryDir: string;

beforeEach(() => {
  memoryDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-room-normalizer-'));
});

afterEach(() => {
  rmSync(memoryDir, { recursive: true, force: true });
});

describe('room task normalizer', () => {
  it('does not enqueue bare execution nudges as tasks', async () => {
    await enqueueRoomDirective(memoryDir, '做', 'room-msg-1', 'alex');
    await enqueueRoomDirective(memoryDir, '用最好的方式', 'room-msg-2', 'alex');

    expect(queryMemoryIndexSync(memoryDir, { type: ['task'] })).toHaveLength(0);
  });

  it('abandons old non-actionable room tasks that already entered the queue', async () => {
    const stale = await appendMemoryIndexEntry(memoryDir, {
      type: 'task',
      status: 'pending',
      source: 'room',
      summary: '[表達意圖] 用最好的方式',
      refs: [],
      payload: { roomMsgId: 'old-room-msg', from: 'alex' },
    });
    await appendMemoryIndexEntry(memoryDir, {
      type: 'task',
      status: 'pending',
      source: 'room',
      summary: '修正 autonomy closure runtime-workspace dirty gate',
      refs: [],
      payload: { roomMsgId: 'actionable-room-msg', from: 'alex' },
    });

    const result = await pruneNonActionableRoomTasks(memoryDir);

    expect(result).toEqual({ pruned: 1 });
    expect(queryMemoryIndexSync(memoryDir, { id: stale.id })[0]).toEqual(expect.objectContaining({
      status: 'abandoned',
      payload: expect.objectContaining({ pruned_reason: 'non-actionable-room-directive' }),
    }));
    expect(queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending'] })).toHaveLength(1);
  });
});
