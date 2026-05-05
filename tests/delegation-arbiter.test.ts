import { describe, expect, it } from 'vitest';
import { buildWorkItemForDelegation } from '../src/delegation.js';

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
});
