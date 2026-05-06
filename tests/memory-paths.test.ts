import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  evaluateRuntimeMemoryPlacement,
  getMemoryDirSource,
  getMemoryRootDir,
  getMemoryStateRootDir,
  resolveMemoryPath,
} from '../src/memory-paths.js';

const original = process.env.MINI_AGENT_MEMORY_DIR;
const originalProtectedRoot = process.env.MINI_AGENT_RUNTIME_WORKSPACE;
const originalAllowRepoMemory = process.env.MINI_AGENT_ALLOW_REPO_MEMORY;

afterEach(() => {
  if (original === undefined) delete process.env.MINI_AGENT_MEMORY_DIR;
  else process.env.MINI_AGENT_MEMORY_DIR = original;
  if (originalProtectedRoot === undefined) delete process.env.MINI_AGENT_RUNTIME_WORKSPACE;
  else process.env.MINI_AGENT_RUNTIME_WORKSPACE = originalProtectedRoot;
  if (originalAllowRepoMemory === undefined) delete process.env.MINI_AGENT_ALLOW_REPO_MEMORY;
  else process.env.MINI_AGENT_ALLOW_REPO_MEMORY = originalAllowRepoMemory;
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

  it('requires external memory when running from the protected runtime workspace', () => {
    const repo = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-runtime-'));
    process.env.MINI_AGENT_RUNTIME_WORKSPACE = repo;
    delete process.env.MINI_AGENT_MEMORY_DIR;

    const decision = evaluateRuntimeMemoryPlacement(repo);

    expect(decision.ok).toBe(false);
    expect(decision.reason).toContain('MINI_AGENT_MEMORY_DIR is required');

    rmSync(repo, { recursive: true, force: true });
  });

  it('rejects protected runtime memory paths inside the repo checkout', () => {
    const repo = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-runtime-'));
    process.env.MINI_AGENT_RUNTIME_WORKSPACE = repo;
    process.env.MINI_AGENT_MEMORY_DIR = path.join(repo, 'memory');

    const decision = evaluateRuntimeMemoryPlacement(repo);

    expect(decision.ok).toBe(false);
    expect(decision.reason).toContain('outside protected repo checkout');

    rmSync(repo, { recursive: true, force: true });
  });

  it('accepts an existing external memory directory for the protected runtime workspace', () => {
    const repo = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-runtime-'));
    const memory = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-memory-'));
    process.env.MINI_AGENT_RUNTIME_WORKSPACE = repo;
    process.env.MINI_AGENT_MEMORY_DIR = memory;

    const decision = evaluateRuntimeMemoryPlacement(repo);

    expect(decision.ok).toBe(true);
    expect(decision.reason).toContain('external memory');

    rmSync(repo, { recursive: true, force: true });
    rmSync(memory, { recursive: true, force: true });
  });

  it('allows an explicit recovery override for repo-local runtime memory', () => {
    const repo = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-runtime-'));
    process.env.MINI_AGENT_RUNTIME_WORKSPACE = repo;
    process.env.MINI_AGENT_ALLOW_REPO_MEMORY = '1';
    delete process.env.MINI_AGENT_MEMORY_DIR;

    const decision = evaluateRuntimeMemoryPlacement(repo);

    expect(decision.ok).toBe(true);
    expect(decision.reason).toContain('MINI_AGENT_ALLOW_REPO_MEMORY=1');

    rmSync(repo, { recursive: true, force: true });
  });
});
