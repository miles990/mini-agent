import path from 'node:path';
import { existsSync } from 'node:fs';
import { evaluateWorkspaceIsolation } from './workspace-isolation.js';

const MEMORY_DIR_ENV = 'MINI_AGENT_MEMORY_DIR';
const ALLOW_REPO_MEMORY_ENV = 'MINI_AGENT_ALLOW_REPO_MEMORY';

export function getMemoryRootDir(cwd = process.cwd()): string {
  const configured = process.env[MEMORY_DIR_ENV]?.trim();
  if (configured) return path.resolve(configured);
  return path.join(cwd, 'memory');
}

export function getMemoryStateRootDir(cwd = process.cwd()): string {
  return path.join(getMemoryRootDir(cwd), 'state');
}

export function resolveMemoryPath(...segments: string[]): string {
  return path.join(getMemoryRootDir(), ...segments);
}

export function getMemoryDirSource(): 'env' | 'repo-default' {
  return process.env[MEMORY_DIR_ENV]?.trim() ? 'env' : 'repo-default';
}

export interface RuntimeMemoryPlacement {
  ok: boolean;
  reason: string;
  memoryRoot: string;
  source: 'env' | 'repo-default';
  repoRoot: string | null;
  protectedRuntimeWorkspace: boolean;
}

export function evaluateRuntimeMemoryPlacement(cwd = process.cwd()): RuntimeMemoryPlacement {
  const memoryRoot = getMemoryRootDir(cwd);
  const source = getMemoryDirSource();
  const workspace = evaluateWorkspaceIsolation(cwd);
  const protectedRoot = workspace.repoRoot ?? cwd;
  const allowedOverride = process.env[ALLOW_REPO_MEMORY_ENV] === '1';

  if (!workspace.protectedRuntimeWorkspace) {
    return {
      ok: true,
      reason: 'isolated worktree may use local memory',
      memoryRoot,
      source,
      repoRoot: workspace.repoRoot,
      protectedRuntimeWorkspace: false,
    };
  }

  if (allowedOverride) {
    return {
      ok: true,
      reason: `${ALLOW_REPO_MEMORY_ENV}=1 override enabled`,
      memoryRoot,
      source,
      repoRoot: workspace.repoRoot,
      protectedRuntimeWorkspace: true,
    };
  }

  if (source !== 'env') {
    return {
      ok: false,
      reason: `${MEMORY_DIR_ENV} is required for protected runtime workspace`,
      memoryRoot,
      source,
      repoRoot: workspace.repoRoot,
      protectedRuntimeWorkspace: true,
    };
  }

  if (isInside(memoryRoot, protectedRoot)) {
    return {
      ok: false,
      reason: `${MEMORY_DIR_ENV} must point outside protected repo checkout`,
      memoryRoot,
      source,
      repoRoot: workspace.repoRoot,
      protectedRuntimeWorkspace: true,
    };
  }

  if (!existsSync(memoryRoot)) {
    return {
      ok: false,
      reason: `${MEMORY_DIR_ENV} does not exist; run pnpm setup:external-memory`,
      memoryRoot,
      source,
      repoRoot: workspace.repoRoot,
      protectedRuntimeWorkspace: true,
    };
  }

  return {
    ok: true,
    reason: 'protected runtime workspace uses external memory',
    memoryRoot,
    source,
    repoRoot: workspace.repoRoot,
    protectedRuntimeWorkspace: true,
  };
}

export function assertRuntimeMemoryPlacement(cwd = process.cwd()): RuntimeMemoryPlacement {
  const decision = evaluateRuntimeMemoryPlacement(cwd);
  if (!decision.ok) {
    throw new Error([
      `[runtime-memory] ${decision.reason}`,
      `memoryRoot=${decision.memoryRoot}`,
      decision.repoRoot ? `repoRoot=${decision.repoRoot}` : null,
      `Fix: set ${MEMORY_DIR_ENV} to an external memory directory, e.g. ../mini-agent-memory/memory.`,
    ].filter(Boolean).join('\n'));
  }
  return decision;
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
