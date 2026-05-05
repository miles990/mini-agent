import { describe, expect, it, vi } from 'vitest';
import { MiddlewareProvider, createDefaultMiddlewareProviders } from '../src/middleware-provider.js';
import type { BrainRequest } from '../src/brain-types.js';
import type { MiddlewareClient, TaskStatus } from '../src/middleware-client.js';
import { TaskFailedError, WaitTimeoutError } from '../src/middleware-client.js';

function request(overrides: Partial<BrainRequest> = {}): BrainRequest {
  return {
    taskId: 'task-1',
    source: 'background',
    intent: 'code',
    prompt: 'Implement adapter',
    systemPrompt: 'system prompt',
    cwd: '/repo',
    timeoutMs: 5000,
    risk: 'workspace_write',
    tools: ['read', 'write'],
    ...overrides,
  };
}

function client(overrides: Partial<MiddlewareClient> = {}): MiddlewareClient {
  return {
    dispatch: vi.fn(async () => ({ taskId: 'mw-1', status: 'pending' })),
    waitFor: vi.fn(async (): Promise<TaskStatus> => ({
      id: 'mw-1',
      worker: 'coder',
      status: 'completed',
      result: 'middleware completed',
      retryCount: 0,
    })),
    health: vi.fn(async () => ({
      status: 'ok',
      service: 'agent-middleware',
      workers: ['coder', 'agent-brain', 'shell'],
      tasks: 0,
    })),
    cancel: vi.fn(async () => undefined),
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

describe('MiddlewareProvider', () => {
  it('reports health from worker availability', async () => {
    const provider = new MiddlewareProvider({ id: 'codex', worker: 'coder', client: client() });
    await expect(provider.health()).resolves.toEqual(expect.objectContaining({
      available: true,
      detail: 'middleware worker coder available',
    }));
  });

  it('runs middleware dispatch and converts terminal status to BrainResult', async () => {
    const fakeClient = client();
    const provider = new MiddlewareProvider({ id: 'codex', worker: 'coder', client: fakeClient, pollMs: 1 });

    const result = await provider.run(request());

    expect(fakeClient.dispatch).toHaveBeenCalledWith(expect.objectContaining({
      worker: 'coder',
      cwd: '/repo',
      timeoutSeconds: 5,
    }));
    expect((fakeClient.dispatch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].task).toContain('<brain-request');
    expect(fakeClient.waitFor).toHaveBeenCalledWith('mw-1', { timeoutMs: 5000, pollMs: 1 });
    expect(result).toEqual(expect.objectContaining({
      provider: 'codex',
      text: 'middleware completed',
      finishReason: 'success',
    }));
  });

  it('passes shell prompts without the brain request envelope', async () => {
    const fakeClient = client();
    const provider = new MiddlewareProvider({ id: 'shell', worker: 'shell', client: fakeClient });

    await provider.run(request({ intent: 'verify', risk: 'read_only', prompt: 'pnpm test' }));

    expect((fakeClient.dispatch as ReturnType<typeof vi.fn>).mock.calls[0]?.[0].task).toBe('pnpm test');
  });

  it('returns timeout and error finish reasons without throwing', async () => {
    const timeoutProvider = new MiddlewareProvider({
      id: 'codex',
      worker: 'coder',
      client: client({ waitFor: vi.fn(async () => { throw new WaitTimeoutError('mw-1', 5000); }) }),
    });
    await expect(timeoutProvider.run(request())).resolves.toEqual(expect.objectContaining({
      finishReason: 'timeout',
    }));

    const failedProvider = new MiddlewareProvider({
      id: 'codex',
      worker: 'coder',
      client: client({ waitFor: vi.fn(async () => { throw new TaskFailedError('mw-1', 'bad patch'); }) }),
    });
    await expect(failedProvider.run(request())).resolves.toEqual(expect.objectContaining({
      finishReason: 'error',
      text: 'task mw-1 failed: bad patch',
    }));
  });

  it('creates the default middleware provider set for runtime registration', () => {
    const providers = createDefaultMiddlewareProviders(client());
    expect(providers.map(provider => provider.id)).toEqual(['claude', 'codex', 'local', 'shell']);
  });
});
