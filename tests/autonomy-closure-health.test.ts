import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeResolvedAutonomyClosureTasks,
  ensureAutonomyClosureTask,
  evaluateAutonomyClosure,
} from '../src/autonomy-closure-health.js';
import { queryMemoryIndexSync } from '../src/memory-index.js';

describe('autonomy closure health', () => {
  let tmpDir: string;
  let repoRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-autonomy-closure-'));
    repoRoot = path.join(tmpDir, 'runtime');
    mkdirSync(repoRoot, { recursive: true });
    mkdirSync(path.join(tmpDir, 'state'), { recursive: true });
    mkdirSync(path.join(tmpDir, 'index'), { recursive: true });
    vi.stubEnv('MINI_AGENT_MEMORY_DIR', tmpDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reports a healthy closed loop when observable memory has no blockers', () => {
    writeFileSync(path.join(tmpDir, 'state/task-events.jsonl'), '', 'utf-8');
    writeFileSync(path.join(tmpDir, 'index/relations.jsonl'), '', 'utf-8');

    const snapshot = evaluateAutonomyClosure(tmpDir, { repoRoot });

    expect(snapshot.status).toBe('healthy');
    expect(snapshot.recommendedTask).toBeNull();
    expect(snapshot.stages.map(s => s.stage)).toContain('memory-context');
  });

  it('creates one repair task for exhausted autonomous execution', async () => {
    writeFileSync(
      path.join(tmpDir, 'state/task-events.jsonl'),
      JSON.stringify({
        id: 'idx-exhausted',
        ts: '2026-05-07T00:00:00.000Z',
        type: 'task',
        status: 'hold',
        summary: 'P1 failing autonomous issue repair',
        refs: [],
        payload: {
          origin: 'github-issue',
          priority: 1,
          verify_command: 'pnpm test',
          auto_executor_failures: 3,
        },
      }) + '\n',
      'utf-8',
    );
    writeFileSync(path.join(tmpDir, 'index/relations.jsonl'), '', 'utf-8');

    const snapshot = evaluateAutonomyClosure(tmpDir, { repoRoot });
    expect(snapshot.status).toBe('blocked');
    expect(snapshot.blockingStages).toContain('task-execution');

    const task = await ensureAutonomyClosureTask(tmpDir, snapshot);
    const duplicate = await ensureAutonomyClosureTask(tmpDir, snapshot);

    expect(task?.summary).toContain('P0 autonomy closure: repair task-execution');
    expect(duplicate?.id).toBe(task?.id);
    const tasks = queryMemoryIndexSync(tmpDir, { type: ['task'], status: ['pending'] })
      .filter(t => (t.payload as Record<string, unknown>)?.origin === 'autonomy-closure');
    expect(tasks).toHaveLength(1);
  });

  it('closes active autonomy closure task after blockers resolve', async () => {
    writeFileSync(
      path.join(tmpDir, 'state/task-events.jsonl'),
      [
        JSON.stringify({
          id: 'idx-existing',
          ts: '2026-05-07T00:00:00.000Z',
          type: 'task',
          status: 'pending',
          summary: 'P0 autonomy closure: repair task-execution',
          refs: [],
          tags: ['autonomy-closure'],
          payload: { origin: 'autonomy-closure', priority: 0 },
        }),
      ].join('\n') + '\n',
      'utf-8',
    );
    writeFileSync(path.join(tmpDir, 'index/relations.jsonl'), '', 'utf-8');

    const snapshot = evaluateAutonomyClosure(tmpDir, { repoRoot });
    const closed = await closeResolvedAutonomyClosureTasks(tmpDir, snapshot);

    expect(snapshot.status).toBe('healthy');
    expect(closed).toHaveLength(1);
    expect(queryMemoryIndexSync(tmpDir, { id: 'idx-existing', limit: 1 })[0].status).toBe('completed');
  });

  it('refreshes an existing repair task with the latest closure snapshot', async () => {
    writeFileSync(
      path.join(tmpDir, 'state/task-events.jsonl'),
      [
        JSON.stringify({
          id: 'idx-existing',
          ts: '2026-05-07T00:00:00.000Z',
          type: 'task',
          status: 'pending',
          summary: 'P0 autonomy closure: repair old-stage',
          refs: [],
          tags: ['autonomy-closure'],
          payload: {
            origin: 'autonomy-closure',
            priority: 0,
            acceptance_criteria: 'old stale blocker',
          },
        }),
        JSON.stringify({
          id: 'idx-exhausted',
          ts: '2026-05-07T00:00:00.000Z',
          type: 'task',
          status: 'hold',
          summary: 'P1 failing autonomous issue repair',
          refs: [],
          payload: {
            origin: 'github-issue',
            priority: 1,
            verify_command: 'pnpm test',
            auto_executor_failures: 3,
          },
        }),
      ].join('\n') + '\n',
      'utf-8',
    );
    writeFileSync(path.join(tmpDir, 'index/relations.jsonl'), '', 'utf-8');

    const snapshot = evaluateAutonomyClosure(tmpDir, { repoRoot });
    const task = await ensureAutonomyClosureTask(tmpDir, snapshot);

    expect(task?.id).toBe('idx-existing');
    expect(task?.summary).toBe('P0 autonomy closure: repair task-execution');
    expect(task?.payload?.acceptance_criteria).toContain('1 task(s) exhausted autonomous retries');
    expect(task?.payload?.closure_refreshed_at).toEqual(expect.any(String));
  });
});
