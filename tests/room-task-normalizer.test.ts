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

  it('decomposes complex product directives into PM, implementation, UX, content, visual, and QA work', async () => {
    await enqueueRoomDirective(
      memoryDir,
      'ai agent 也是我的 PM 也是我的工程師 我的前端 我的美術。它要可以整理我的需求分析脈絡，將任務解構且條列出來，並一一滿足。',
      'room-msg-pm',
      'alex',
    );

    const roleOrder = ['pm', 'engineer', 'frontend', 'content', 'visual', 'qa'];
    const tasks = queryMemoryIndexSync(memoryDir, { type: ['task'] });
    const parent = tasks.find(t => t.status === 'decomposed');
    const subtasks = tasks
      .filter(t => t.status === 'pending')
      .sort((a, b) => roleOrder.indexOf(String((a.payload ?? {}).role)) - roleOrder.indexOf(String((b.payload ?? {}).role)));

    expect(parent?.summary).toContain('ai agent');
    expect(subtasks).toHaveLength(6);
    expect(subtasks.map(t => (t.payload ?? {}).role)).toEqual(roleOrder);
    expect(subtasks.every(t => typeof (t.payload ?? {}).acceptance_criteria === 'string')).toBe(true);
  });
});
