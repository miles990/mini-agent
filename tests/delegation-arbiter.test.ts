import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/activity-journal.js', () => ({
  writeActivity: vi.fn(),
}));

vi.mock('../src/middleware-client.js', () => ({
  middleware: vi.fn(() => ({
    createCommitment: vi.fn().mockResolvedValue({ id: 'commitment-1' }),
    resolveCommitment: vi.fn().mockResolvedValue(undefined),
    plan: vi.fn(() => new Promise(() => {})),
    accomplish: vi.fn(() => new Promise(() => {})),
    cancelPlan: vi.fn().mockResolvedValue(undefined),
    health: vi.fn().mockResolvedValue({
      status: 'ok',
      service: 'agent-middleware',
      workers: ['coder', 'agent-brain', 'shell', 'cloud-agent'],
      tasks: 0,
    }),
    dispatch: vi.fn().mockResolvedValue({ taskId: 'mw-1', status: 'pending' }),
    waitFor: vi.fn().mockResolvedValue({
      id: 'mw-1',
      worker: 'coder',
      status: 'completed',
      result: 'runtime completed',
      retryCount: 0,
    }),
    cancel: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../src/forge.js', () => ({
  forgeCreate: vi.fn(() => null),
  forgeYolo: vi.fn(() => false),
  forgeCleanup: vi.fn(),
}));

vi.mock('../src/delegation-summary.js', () => ({
  extractDelegationSummary: vi.fn((text: string, cap: number) => text.slice(0, cap)),
  buildRecentDelegationSummary: vi.fn(() => ''),
  persistDelegationResult: vi.fn(),
  writeLaneOutput: vi.fn(),
}));

vi.mock('../src/claim-ledger.js', () => ({
  appendProviderClaim: vi.fn((_memoryDir, claim) => claim),
}));

vi.mock('../src/shared-knowledge.js', () => ({
  observe: vi.fn(),
}));

import {
  buildWorkItemForDelegation,
  getActiveWriteLeases,
  getTaskResult,
  awaitDelegation,
  killAllDelegations,
  spawnDelegation,
} from '../src/delegation.js';

beforeEach(() => {
  delete process.env.MINI_AGENT_DELEGATION_RUNTIME;
  killAllDelegations();
});

describe('delegation arbitration mapping', () => {
  it('maps code delegations to workspace-write code work', () => {
    const item = buildWorkItemForDelegation('del-1', {
      prompt: 'Update src/agent.ts and tests/agent.test.ts',
      workdir: '/repo',
      type: 'code',
    }, 'code');

    expect(item.intent).toBe('code');
    expect(item.risk).toBe('workspace_write');
    expect(item.writeScope).toEqual(['src/agent.ts', 'tests/agent.test.ts']);
    expect(item.priority).toBe('P1');
  });

  it('maps research delegations to read-only research work', () => {
    const item = buildWorkItemForDelegation('del-2', {
      prompt: 'Research provider routing options',
      workdir: '/repo',
      type: 'research',
    }, 'research');

    expect(item.intent).toBe('research');
    expect(item.risk).toBe('read_only');
    expect(item.writeScope).toBeUndefined();
  });

  it('promotes deploy/delete language to external-write risk', () => {
    const item = buildWorkItemForDelegation('del-3', {
      prompt: 'P0 deploy this and push main',
      workdir: '/repo',
      type: 'shell',
    }, 'shell');

    expect(item.intent).toBe('verify');
    expect(item.priority).toBe('P0');
    expect(item.risk).toBe('external_write');
  });

  it('maps Akari consultation to architecture work', () => {
    const item = buildWorkItemForDelegation('del-4', {
      prompt: 'Ask Akari to critique this design',
      workdir: '/repo',
      type: 'akari',
    }, 'akari');

    expect(item.intent).toBe('architecture');
    expect(item.tags).toContain('akari');
  });

  it('acquires a write lease for workspace-write delegations', () => {
    const id = spawnDelegation({
      prompt: 'Update src/agent.ts',
      workdir: '/repo',
      type: 'code',
    });

    expect(getTaskResult(id)?.status).toBe('running');
    expect(getActiveWriteLeases()).toEqual([
      expect.objectContaining({
        taskId: id,
        holder: 'codex',
        fileScopes: ['src/agent.ts'],
      }),
    ]);
  });

  it('blocks overlapping write scopes instead of dispatching them', () => {
    const first = spawnDelegation({
      prompt: 'Update src/agent.ts',
      workdir: '/repo',
      type: 'code',
    });
    const second = spawnDelegation({
      prompt: 'Refactor src/agent.ts',
      workdir: '/repo',
      type: 'code',
    });

    expect(getTaskResult(first)?.status).toBe('running');
    expect(getTaskResult(second)?.status).toBe('failed');
    expect(getTaskResult(second)?.output).toContain('blocked by write lease');
    expect(getActiveWriteLeases()).toHaveLength(1);
  });

  it('blocks external writes before dispatch', () => {
    const id = spawnDelegation({
      prompt: 'P0 deploy this and push main',
      workdir: '/repo',
      type: 'shell',
    });

    expect(getTaskResult(id)?.status).toBe('failed');
    expect(getTaskResult(id)?.output).toContain('blocked by arbiter');
  });

  it('can execute delegations through BrainRuntime when enabled', async () => {
    process.env.MINI_AGENT_DELEGATION_RUNTIME = 'true';
    const id = spawnDelegation({
      prompt: 'Review the runtime adapter',
      workdir: '/repo',
      type: 'review',
    });

    const result = await awaitDelegation(id, 1000);

    expect(result.status).toBe('completed');
    expect(result.output).toContain('[brain-runtime] status=success');
    expect(result.output).toContain('runtime completed');
    expect(result.runtime).toEqual(expect.objectContaining({
      engine: 'brain-runtime',
      mode: 'race',
      status: 'success',
      primary: 'claude',
    }));
    expect(result.runtime?.runs).toEqual([
      expect.objectContaining({ actor: 'claude', status: 'success', finishReason: 'success' }),
      expect.objectContaining({ actor: 'codex', status: 'success', finishReason: 'success' }),
    ]);
    expect(result.runtime?.claimIds).toHaveLength(2);
  });

  it('includes Akari peer critique for architecture delegations through BrainRuntime', async () => {
    process.env.MINI_AGENT_DELEGATION_RUNTIME = 'true';
    const id = spawnDelegation({
      prompt: 'Ask Akari to critique the multi-brain runtime',
      workdir: '/repo',
      type: 'akari',
    });

    const result = await awaitDelegation(id, 1000);

    expect(result.status).toBe('completed');
    expect(result.runtime).toEqual(expect.objectContaining({
      engine: 'brain-runtime',
      mode: 'panel',
      primary: 'claude',
    }));
    expect(result.runtime?.runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ actor: 'akari', role: 'reviewer', status: 'success' }),
    ]));
  });
});
