import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
      workers: ['coder', 'agent-brain', 'shell', 'cloud-agent', 'create', 'reviewer', 'planner'],
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
  prepareForgeWorkspace: vi.fn((opts: { workdir: string; requiresIsolation: boolean }) => ({
    cwd: opts.requiresIsolation ? '/repo-forge/default' : opts.workdir,
    ...(opts.requiresIsolation ? { worktree: '/repo-forge/default' } : {}),
  })),
  finalizeForgeWorkspace: vi.fn((opts: { worktree: string }) => ({
    outcome: { worktree: opts.worktree, created: true, merged: false, cleaned: true },
    outputSuffix: '\n[forge] merge skipped (verify failed or no changes)',
  })),
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
import { prepareForgeWorkspace } from '../src/forge.js';

function validPrompt(text: string): string {
  return [
    '## Task:',
    text,
    '',
    '## Context:',
    'This is an explicit test envelope that should pass the phantom-prompt pre-dispatch guard.',
  ].join('\n');
}

const ORIGINAL_MEMORY_DIR = process.env.MINI_AGENT_MEMORY_DIR;
let testMemoryDir: string | undefined;

beforeEach(() => {
  testMemoryDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-delegation-arbiter-'));
  process.env.MINI_AGENT_MEMORY_DIR = testMemoryDir;
  delete process.env.MINI_AGENT_DELEGATION_RUNTIME;
  vi.mocked(prepareForgeWorkspace).mockReset();
  vi.mocked(prepareForgeWorkspace).mockImplementation((opts: { workdir: string; requiresIsolation: boolean }) => ({
    cwd: opts.requiresIsolation ? '/repo-forge/default' : opts.workdir,
    ...(opts.requiresIsolation ? { worktree: '/repo-forge/default' } : {}),
  }));
  killAllDelegations();
});

afterEach(() => {
  killAllDelegations();
  if (testMemoryDir) {
    rmSync(testMemoryDir, { recursive: true, force: true });
    testMemoryDir = undefined;
  }
  if (ORIGINAL_MEMORY_DIR === undefined) {
    delete process.env.MINI_AGENT_MEMORY_DIR;
  } else {
    process.env.MINI_AGENT_MEMORY_DIR = ORIGINAL_MEMORY_DIR;
  }
  delete process.env.MINI_AGENT_DELEGATION_RUNTIME;
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
      prompt: validPrompt('Update src/agent.ts'),
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

  it('allocates forge worktrees for create delegations that can write workspace files', () => {
    vi.mocked(prepareForgeWorkspace).mockReturnValueOnce({ cwd: '/repo-forge/create-1', worktree: '/repo-forge/create-1' });

    const id = spawnDelegation({
      prompt: validPrompt('Create docs/guide.md'),
      workdir: '/repo',
      type: 'create',
    });

    expect(getTaskResult(id)?.status).toBe('running');
    expect(prepareForgeWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      taskId: id,
      workdir: '/repo',
      taskType: 'create',
      requiresIsolation: true,
    }));
  });

  it('blocks workspace writes when forge allocation fails', () => {
    vi.mocked(prepareForgeWorkspace).mockReturnValueOnce({
      cwd: process.cwd(),
      blockedReason: 'blocked by workspace isolation policy: forge worktree allocation failed for repo',
    });

    const id = spawnDelegation({
      prompt: validPrompt('Update src/agent.ts'),
      workdir: process.cwd(),
      type: 'code',
    });

    expect(getTaskResult(id)?.status).toBe('failed');
    expect(getTaskResult(id)?.output).toContain('workspace isolation policy');
    expect(getActiveWriteLeases()).toHaveLength(0);
  });

  it('blocks overlapping write scopes instead of dispatching them', () => {
    const first = spawnDelegation({
      prompt: validPrompt('Update src/agent.ts'),
      workdir: '/repo',
      type: 'code',
    });
    const second = spawnDelegation({
      prompt: validPrompt('Refactor src/agent.ts'),
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
      prompt: validPrompt('P0 deploy this and push main after verification evidence is complete'),
      workdir: '/repo',
      type: 'shell',
    });

    expect(getTaskResult(id)?.status).toBe('failed');
    expect(getTaskResult(id)?.output).toContain('blocked by arbiter');
  });

  it('can execute delegations through BrainRuntime when enabled', async () => {
    process.env.MINI_AGENT_DELEGATION_RUNTIME = 'true';
    const id = spawnDelegation({
      prompt: validPrompt('Review the runtime adapter and return verification evidence for the delegated run'),
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
    }));
    expect(['claude', 'codex']).toContain(result.runtime?.primary);
    expect(result.runtime?.runs).toContainEqual(
      expect.objectContaining({ actor: result.runtime?.primary, status: 'success', finishReason: 'success' }),
    );
    expect(result.runtime?.runs).toContainEqual(
      expect.objectContaining({ role: 'reviewer', status: 'success' }),
    );
    expect(result.runtime?.claimIds).toHaveLength(2);
  });

  it('includes Akari peer critique for architecture delegations through BrainRuntime', async () => {
    process.env.MINI_AGENT_DELEGATION_RUNTIME = 'true';
    const id = spawnDelegation({
      prompt: validPrompt('Ask Akari to critique the multi-brain runtime and summarize actionable design risk'),
      workdir: '/repo',
      type: 'akari',
    });

    const result = await awaitDelegation(id, 1000);

    expect(result.status).toBe('completed');
    expect(result.runtime).toEqual(expect.objectContaining({
      engine: 'brain-runtime',
      mode: 'panel',
      primary: 'kuro',
    }));
    expect(result.runtime?.runs).toEqual(expect.arrayContaining([
      expect.objectContaining({ actor: 'akari', role: 'reviewer', status: 'success' }),
      expect.objectContaining({ actor: 'kuro', role: 'coordinator', status: 'success' }),
    ]));
  });
});
