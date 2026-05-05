import { describe, expect, it, vi } from 'vitest';
import { MiddlewarePeerAgent, createDefaultMiddlewarePeers } from '../src/middleware-peer-agent.js';
import type { WorkItem } from '../src/brain-types.js';
import type { MiddlewareClient, TaskStatus } from '../src/middleware-client.js';
import { WaitTimeoutError } from '../src/middleware-client.js';

function work(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 'task-1',
    title: 'Review architecture',
    intent: 'architecture',
    priority: 'P1',
    risk: 'read_only',
    ...overrides,
  };
}

function client(overrides: Partial<MiddlewareClient> = {}): MiddlewareClient {
  return {
    dispatch: vi.fn(async () => ({ taskId: 'mw-peer-1', status: 'pending' })),
    waitFor: vi.fn(async (): Promise<TaskStatus> => ({
      id: 'mw-peer-1',
      worker: 'cloud-agent',
      status: 'completed',
      result: 'Akari critique: keep Kuro as coordinator.',
      retryCount: 0,
    })),
    health: vi.fn(async () => ({
      status: 'ok',
      service: 'agent-middleware',
      workers: ['cloud-agent'],
      tasks: 0,
    })),
    cancel: vi.fn(),
    plan: vi.fn(),
    accomplish: vi.fn(),
    status: vi.fn(),
    planStatus: vi.fn(),
    waitForPlan: vi.fn(),
    listWorkers: vi.fn(),
    cancelPlan: vi.fn(),
    createCommitment: vi.fn(),
    getCommitment: vi.fn(),
    resolveCommitment: vi.fn(),
    listCommitments: vi.fn(),
    ...overrides,
  } as unknown as MiddlewareClient;
}

describe('MiddlewarePeerAgent', () => {
  it('reports health from middleware worker availability', async () => {
    const peer = new MiddlewarePeerAgent({ id: 'akari', worker: 'cloud-agent', client: client() });

    await expect(peer.health()).resolves.toEqual(expect.objectContaining({
      available: true,
      detail: 'middleware peer akari via cloud-agent available',
    }));
  });

  it('dispatches peer consultation through middleware', async () => {
    const fakeClient = client();
    const peer = new MiddlewarePeerAgent({ id: 'akari', worker: 'cloud-agent', client: fakeClient, pollMs: 1 });

    const result = await peer.consult({
      task: work(),
      brief: 'Critique this runtime split.',
      requestedRole: 'critic',
      contextPacket: 'context',
    });

    expect(fakeClient.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      worker: 'cloud-agent',
      timeoutSeconds: 300,
    }));
    expect((fakeClient.dispatch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].task).toContain('<peer-consult');
    expect(fakeClient.waitFor).toHaveBeenCalledWith('mw-peer-1', { timeoutMs: 300000, pollMs: 1 });
    expect(result).toEqual(expect.objectContaining({
      peer: 'akari',
      response: 'Akari critique: keep Kuro as coordinator.',
    }));
  });

  it('returns timeout critique instead of throwing', async () => {
    const peer = new MiddlewarePeerAgent({
      id: 'akari',
      worker: 'cloud-agent',
      client: client({ waitFor: vi.fn(async () => { throw new WaitTimeoutError('mw-peer-1', 300000); }) }),
    });

    const result = await peer.consult({
      task: work(),
      brief: 'Critique this runtime split.',
      requestedRole: 'critic',
    });

    expect(result.critiques[0]).toContain('did not complete');
    expect(result.recommendations).toEqual(['retry with a narrower brief']);
  });

  it('creates Akari by default and Tanren only when configured', () => {
    const original = process.env.TANREN_MIDDLEWARE_WORKER;
    delete process.env.TANREN_MIDDLEWARE_WORKER;
    expect(createDefaultMiddlewarePeers(client()).map(peer => peer.id)).toEqual(['akari']);

    process.env.TANREN_MIDDLEWARE_WORKER = 'tanren-agent';
    expect(createDefaultMiddlewarePeers(client()).map(peer => peer.id)).toEqual(['akari', 'tanren']);

    if (original === undefined) delete process.env.TANREN_MIDDLEWARE_WORKER;
    else process.env.TANREN_MIDDLEWARE_WORKER = original;
  });
});
