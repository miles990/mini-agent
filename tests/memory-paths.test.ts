import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';

import { getMemoryDirSource, getMemoryRootDir, getMemoryStateRootDir, resolveMemoryPath } from '../src/memory-paths.js';

const original = process.env.MINI_AGENT_MEMORY_DIR;

afterEach(() => {
  if (original === undefined) delete process.env.MINI_AGENT_MEMORY_DIR;
  else process.env.MINI_AGENT_MEMORY_DIR = original;
});

describe('memory path resolution', () => {
  it('defaults to repo-local memory for backward compatibility', () => {
    delete process.env.MINI_AGENT_MEMORY_DIR;

    expect(getMemoryRootDir('/repo/mini-agent')).toBe(path.join('/repo/mini-agent', 'memory'));
    expect(getMemoryStateRootDir('/repo/mini-agent')).toBe(path.join('/repo/mini-agent', 'memory', 'state'));
    expect(getMemoryDirSource()).toBe('repo-default');
  });

  it('uses MINI_AGENT_MEMORY_DIR as the external state root', () => {
    process.env.MINI_AGENT_MEMORY_DIR = '/state/mini-agent-memory/memory';

    expect(getMemoryRootDir('/repo/mini-agent')).toBe('/state/mini-agent-memory/memory');
    expect(getMemoryStateRootDir('/repo/mini-agent')).toBe('/state/mini-agent-memory/memory/state');
    expect(resolveMemoryPath('handoffs', 'active.md')).toBe('/state/mini-agent-memory/memory/handoffs/active.md');
    expect(getMemoryDirSource()).toBe('env');
  });
});

