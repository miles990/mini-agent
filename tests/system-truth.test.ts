import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canonicalCommitmentKey,
  duplicateActiveCommitments,
  evaluateSystemTruth,
  planSafeMiddlewareActions,
  type MiddlewareCommitmentTruth,
} from '../src/system-truth.js';

describe('system truth reconciliation', () => {
  let tmpDir: string;
  let repoRoot: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-system-truth-'));
    repoRoot = path.join(tmpDir, 'runtime');
    mkdirSync(repoRoot, { recursive: true });
    mkdirSync(path.join(tmpDir, 'state'), { recursive: true });
    mkdirSync(path.join(tmpDir, 'index'), { recursive: true });
    writeFileSync(path.join(tmpDir, 'state/task-events.jsonl'), '', 'utf-8');
    writeFileSync(path.join(tmpDir, 'index/relations.jsonl'), '', 'utf-8');
    vi.stubEnv('MINI_AGENT_MEMORY_DIR', tmpDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('canonicalizes repeated middleware task envelopes across task ids and issue numbers', () => {
    const a = canonicalCommitmentKey('## Task: P0 autonomy closure: repair pr-review-consensus\n\nTask ID: idx-a\n');
    const b = canonicalCommitmentKey('## Task: P0 autonomy closure: repair pr-review-consensus\n\nTask ID: idx-b\n');
    const c = canonicalCommitmentKey('## Task: P1 GitHub issue #167: graphify pipeline\nTask ID: idx-c');
    const d = canonicalCommitmentKey('## Task: P1 GitHub issue #195: graphify pipeline\nTask ID: idx-d');

    expect(a).toBe(b);
    expect(c).toBe(d);
  });

  it('detects duplicate active middleware commitments', () => {
    const base: Omit<MiddlewareCommitmentTruth, 'id' | 'text'> = {
      status: 'active',
      created_at: '2026-05-06T00:00:00.000Z',
    };
    const groups = duplicateActiveCommitments([
      { ...base, id: 'c1', text: '## Task: P0 autonomy closure: repair pr-review-consensus\nTask ID: idx-a' },
      { ...base, id: 'c2', text: '## Task: P0 autonomy closure: repair pr-review-consensus\nTask ID: idx-b' },
      { ...base, id: 'c3', text: '## Task: unrelated' },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].items.map(i => i.id)).toEqual(['c1', 'c2']);
  });

  it('builds a degraded snapshot from live-source mocks without mutating state', async () => {
    writeFileSync(
      path.join(tmpDir, 'state/task-events.jsonl'),
      Array.from({ length: 11 }, (_, i) => JSON.stringify({
        id: `idx-task-${i}`,
        ts: '2026-05-06T00:00:00.000Z',
        type: 'task',
        status: 'pending',
        summary: `pending task ${i}`,
        refs: [],
      })).join('\n') + '\n',
      'utf-8',
    );

    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/health') && url.includes('middleware')) {
        return jsonResponse({ status: 'ok', service: 'agent-middleware', workers: [], tasks: 2 });
      }
      if (url.includes('/commits')) {
        return jsonResponse({
          items: [
            {
              id: 'c1',
              status: 'active',
              created_at: '2026-05-06T00:00:00.000Z',
              text: '## Task: P0 autonomy closure: repair pr-review-consensus\nTask ID: idx-a',
            },
            {
              id: 'c2',
              status: 'active',
              created_at: '2026-05-06T00:10:00.000Z',
              text: '## Task: P0 autonomy closure: repair pr-review-consensus\nTask ID: idx-b',
            },
          ],
        });
      }
      if (url.includes('/tasks')) return jsonResponse({ tasks: [] });
      if (url.endsWith('/health') && url.includes('kg')) return jsonResponse({ status: 'ok', service: 'knowledge-graph' });
      if (url.includes('/api/stats')) return jsonResponse({ nodes: 10, edges: 20 });
      if (url.includes('/api/push/formatted')) {
        return jsonResponse({ text: '<kg-push>\n- **kuro: 收到** [observation]\n- **claude-code: done** [observation]\n</kg-push>' });
      }
      throw new Error(`unexpected url ${url}`);
    }) as unknown as typeof fetch;

    const snapshot = await evaluateSystemTruth({
      memoryDir: tmpDir,
      repoRoot,
      middlewareUrl: 'http://middleware',
      kgUrl: 'http://kg',
      now: new Date('2026-05-06T13:00:00.000Z'),
      fetchImpl,
    });

    expect(snapshot.status).toBe('degraded');
    expect(snapshot.counts.localActiveTasks).toBe(11);
    expect(snapshot.counts.middlewareActiveCommitments).toBe(2);
    expect(snapshot.counts.kgNodes).toBe(10);
    expect(snapshot.findings.map(f => f.kind)).toContain('local-task-backlog');
    expect(snapshot.findings.map(f => f.kind)).toContain('middleware-duplicate-active');
    expect(snapshot.findings.map(f => f.kind)).toContain('kg-push-low-signal');
  });

  it('plans safe middleware cleanup for older duplicates and linked terminal tasks only', () => {
    const active: MiddlewareCommitmentTruth[] = [
      {
        id: 'old-duplicate',
        status: 'active',
        created_at: '2026-05-06T00:00:00.000Z',
        text: '## Task: P0 autonomy closure: repair pr-review-consensus\nTask ID: idx-a',
      },
      {
        id: 'new-duplicate',
        status: 'active',
        created_at: '2026-05-06T01:00:00.000Z',
        text: '## Task: P0 autonomy closure: repair pr-review-consensus\nTask ID: idx-b',
      },
      {
        id: 'linked-complete',
        status: 'active',
        created_at: '2026-05-06T02:00:00.000Z',
        text: 'delegate completed',
        linked_task_id: 'task-1',
      },
      {
        id: 'linked-running',
        status: 'active',
        created_at: '2026-05-06T02:00:00.000Z',
        text: 'delegate still running',
        linked_task_id: 'task-2',
      },
    ];

    const actions = planSafeMiddlewareActions({
      status: 'degraded',
      generatedAt: '2026-05-06T03:00:00.000Z',
      score: 80,
      counts: {
        localActiveTasks: 0,
        middlewareActiveCommitments: 4,
        middlewareRunningTasks: 1,
        middlewareUnreviewedCompletedTasks: 0,
        kgNodes: 0,
        kgEdges: 0,
      },
      local: { activeTasks: [], autonomyStatus: 'healthy', autonomyScore: 100 },
      middleware: {
        online: true,
        activeCommitments: active,
        recentTasks: [
          { id: 'task-1', worker: 'coder', status: 'completed', task: '' },
          { id: 'task-2', worker: 'coder', status: 'running', task: '' },
        ],
      },
      kg: { online: true, retrievalAugmentEnabled: true },
      findings: [],
    });

    expect(actions).toEqual([
      expect.objectContaining({
        commitmentId: 'old-duplicate',
        action: 'cancel',
        reason: 'duplicate-active-commitment',
      }),
      expect.objectContaining({
        commitmentId: 'linked-complete',
        action: 'fulfill',
        reason: 'linked-task-completed',
      }),
    ]);
  });
});

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as Response;
}
