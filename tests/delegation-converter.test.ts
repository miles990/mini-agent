import { describe, it, expect, vi, beforeEach } from 'vitest';
import { convertAndDispatch, type DelegationTaskInput, type ForgeAllocator } from '../src/delegation-converter.draft.js';
import * as mwClient from '../src/middleware-client.js';

describe('delegation-converter (K2 draft, v2-final §6.4)', () => {
  const dispatch = vi.fn();
  beforeEach(() => {
    dispatch.mockReset();
    dispatch.mockResolvedValue({ taskId: 'task-abc', status: 'pending' });
    vi.spyOn(mwClient, 'createMiddlewareClient').mockReturnValue({
      dispatch,
    } as unknown as ReturnType<typeof mwClient.createMiddlewareClient>);
  });

  it('code worker: allocates forge worktree and passes its cwd', async () => {
    const forgeAllocate: ForgeAllocator = vi.fn(() => '/tmp/forge-wt-1');
    const task: DelegationTaskInput = { type: 'code', prompt: 'do stuff', workdir: '/repo' };
    const id = await convertAndDispatch(task, forgeAllocate);
    expect(id).toBe('task-abc');
    expect(forgeAllocate).toHaveBeenCalledWith('code', '/repo');
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      worker: 'code',
      task: 'do stuff',
      cwd: '/tmp/forge-wt-1',
      timeoutSeconds: 300,
    }));
  });

  it('non-code worker: skips forge, uses task.workdir', async () => {
    const forgeAllocate: ForgeAllocator = vi.fn(() => '/should-not-be-used');
    const task: DelegationTaskInput = { type: 'research', prompt: 'survey X', workdir: '/repo' };
    await convertAndDispatch(task, forgeAllocate);
    expect(forgeAllocate).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      worker: 'research',
      cwd: '/repo',
      timeoutSeconds: 480,
    }));
  });

  it('code worker with null forge alloc: falls back to task.workdir', async () => {
    const forgeAllocate: ForgeAllocator = vi.fn(() => null);
    const task: DelegationTaskInput = { type: 'code', prompt: 'x', workdir: '/repo' };
    await convertAndDispatch(task, forgeAllocate);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/repo' }));
  });

  it('missing type defaults to code', async () => {
    const forgeAllocate: ForgeAllocator = vi.fn(() => '/wt');
    await convertAndDispatch({ prompt: 'p', workdir: '/r' }, forgeAllocate);
    expect(forgeAllocate).toHaveBeenCalledWith('code', '/r');
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ worker: 'code' }));
  });

  it('explicit timeoutMs overrides capability default', async () => {
    const forgeAllocate: ForgeAllocator = vi.fn(() => null);
    await convertAndDispatch({ type: 'shell', prompt: 'ls', workdir: '/r', timeoutMs: 15_000 }, forgeAllocate);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ timeoutSeconds: 15 }));
  });

  it('expands ~ in cwd to HOME', async () => {
    const prevHome = process.env.HOME;
    process.env.HOME = '/Users/testhome';
    const forgeAllocate: ForgeAllocator = vi.fn(() => null);
    await convertAndDispatch({ type: 'learn', prompt: 'p', workdir: '~/proj' }, forgeAllocate);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/Users/testhome/proj' }));
    process.env.HOME = prevHome;
  });
});
