import { describe, expect, it, vi } from 'vitest';
import {
  canonicalMiddlewareCommitmentKey,
  planMiddlewareCommitmentTruthActions,
  reconcileMiddlewareCommitmentsSafe,
} from '../src/middleware-truth-reconciler.js';
import type { Commitment } from '../src/middleware-client.js';

function commitment(overrides: Partial<Commitment>): Commitment {
  return {
    id: 'cmt-1',
    created_at: '2026-05-07T00:00:00.000Z',
    owner: 'kuro',
    source: { channel: 'delegate' },
    text: '## Task: P0: Fix dispatch suppression\nTask ID: idx-a',
    parsed: { action: 'fix' },
    acceptance: 'tests pass',
    status: 'active',
    ...overrides,
  };
}

describe('middleware truth reconciler', () => {
  it('canonicalizes generated task ids while preserving issue identity', () => {
    const a = canonicalMiddlewareCommitmentKey(commitment({
      text: '## Task: P0: Fix #196 dispatch suppression\nTask ID: idx-alpha-1234567890',
    }));
    const b = canonicalMiddlewareCommitmentKey(commitment({
      text: '## Task: P0: Fix #196 dispatch suppression\nTask ID: idx-beta-1234567890',
    }));
    const c = canonicalMiddlewareCommitmentKey(commitment({
      text: '## Task: P0: Fix #211 dispatch suppression\nTask ID: idx-beta-1234567890',
    }));

    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('plans only mechanically provable terminal and duplicate actions', () => {
    const actions = planMiddlewareCommitmentTruthActions([
      commitment({
        id: 'linked-completed',
        linked_task_id: 'task-completed',
        created_at: '2026-05-07T00:00:00.000Z',
      }),
      commitment({
        id: 'linked-failed',
        linked_task_id: 'task-failed',
        created_at: '2026-05-07T00:01:00.000Z',
      }),
      commitment({
        id: 'old-duplicate',
        text: '## Task: P1: Same work\nTask ID: idx-old-1234567890',
        created_at: '2026-05-07T00:02:00.000Z',
      }),
      commitment({
        id: 'new-duplicate',
        text: '## Task: P1: Same work\nTask ID: idx-new-1234567890',
        created_at: '2026-05-07T00:03:00.000Z',
      }),
      commitment({
        id: 'linked-running',
        linked_task_id: 'task-running',
        text: '## Task: P2: Still running',
        created_at: '2026-05-07T00:04:00.000Z',
      }),
    ], [
      { id: 'task-completed', status: 'completed' },
      { id: 'task-failed', status: 'failed' },
      { id: 'task-running', status: 'running' },
    ]);

    expect(actions).toEqual([
      {
        type: 'fulfill',
        id: 'linked-completed',
        reason: 'linked-task-completed',
        evidence: 'middleware task task-completed completed',
      },
      {
        type: 'cancel',
        id: 'linked-failed',
        reason: 'linked-task-terminal',
        evidence: 'middleware task task-failed failed',
      },
      {
        type: 'cancel',
        id: 'old-duplicate',
        reason: 'duplicate-active-commitment',
        evidence: 'duplicate active commitment; kept newest new-duplicate',
      },
    ]);
  });

  it('patches planned reconciliation actions through middleware status updates', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/tasks?limit=200')) {
        return new Response(JSON.stringify({ tasks: [{ id: 'task-completed', status: 'completed' }] }), { status: 200 });
      }
      if (url.endsWith('/commits?status=active')) {
        return new Response(JSON.stringify([
          commitment({ id: 'cmt/completed', linked_task_id: 'task-completed' }),
        ]), { status: 200 });
      }
      if (url.endsWith('/commit/cmt%2Fcompleted') && init?.method === 'PATCH') {
        expect(JSON.parse(String(init.body))).toMatchObject({
          status: 'fulfilled',
          resolution: { kind: 'task-close' },
        });
        return new Response('', { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as unknown as typeof fetch;

    await expect(reconcileMiddlewareCommitmentsSafe({
      baseUrl: 'http://middleware.test',
      fetchImpl,
    })).resolves.toEqual({ planned: 1, applied: 1, skipped: 0 });
  });
});
