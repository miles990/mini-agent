import { execFileSync } from 'node:child_process';
import path from 'node:path';

export interface WorkspaceIsolationSnapshot {
  cwd: string;
  repoRoot: string | null;
  branch: string | null;
  protectedRuntimeWorkspace: boolean;
  dirtyPaths: string[];
  codeDirtyPaths: string[];
}

export interface WorkspaceIsolationDecision extends WorkspaceIsolationSnapshot {
  ok: boolean;
  reason: string;
  warnings: string[];
}

const SAFE_RUNTIME_BRANCHES = new Set(['runtime/main']);
const CODE_PATH_PATTERN = /^(src|tests|scripts|plugins|skills|tools|kuro-portfolio|knowledge-graph|\.githooks|\.github)\//;
const CODE_FILE_PATTERN = /^(package\.json|pnpm-lock\.yaml|tsconfig\.json|agent-compose\.yaml)$/;

export function evaluateWorkspaceIsolation(cwd = process.cwd(), protectedRoot = process.env.MINI_AGENT_RUNTIME_WORKSPACE): WorkspaceIsolationDecision {
  const repoRoot = git(cwd, ['rev-parse', '--show-toplevel']) || null;
  const branch = git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']) || null;
  const dirtyPaths = parseDirtyPaths(git(cwd, ['status', '--porcelain']) ?? '');
  const codeDirtyPaths = dirtyPaths.filter(isCodePath);
  const protectedRuntimeWorkspace = isProtectedRuntimeWorkspace(cwd, repoRoot, protectedRoot);
  const warnings: string[] = [];

  if (!protectedRuntimeWorkspace) {
    return {
      cwd,
      repoRoot,
      branch,
      protectedRuntimeWorkspace,
      dirtyPaths,
      codeDirtyPaths,
      ok: true,
      reason: 'isolated worktree',
      warnings,
    };
  }

  if (!isSafeRuntimeBranch(branch)) {
    return {
      cwd,
      repoRoot,
      branch,
      protectedRuntimeWorkspace,
      dirtyPaths,
      codeDirtyPaths,
      ok: false,
      reason: `protected runtime workspace is on branch ${branch ?? 'unknown'}; expected runtime/main`,
      warnings,
    };
  }

  if (codeDirtyPaths.length > 0) {
    return {
      cwd,
      repoRoot,
      branch,
      protectedRuntimeWorkspace,
      dirtyPaths,
      codeDirtyPaths,
      ok: false,
      reason: `protected runtime workspace has code/config dirt: ${codeDirtyPaths.slice(0, 5).join(', ')}`,
      warnings,
    };
  }

  if (dirtyPaths.length > 0) {
    warnings.push(`runtime workspace has non-code dirt: ${dirtyPaths.slice(0, 5).join(', ')}`);
  }

  return {
    cwd,
    repoRoot,
    branch,
    protectedRuntimeWorkspace,
    dirtyPaths,
    codeDirtyPaths,
    ok: true,
    reason: 'protected runtime workspace is safe for isolated delegation',
    warnings,
  };
}

export function parseDirtyPaths(porcelain: string): string[] {
  return porcelain
    .split('\n')
    .map(line => line.trimEnd())
    .filter(Boolean)
    .map(parseDirtyPath)
    .filter(Boolean);
}

export function isCodePath(filePath: string): boolean {
  return CODE_PATH_PATTERN.test(filePath) || CODE_FILE_PATTERN.test(filePath);
}

export function isSafeRuntimeBranch(branch: string | null | undefined): boolean {
  return Boolean(branch && SAFE_RUNTIME_BRANCHES.has(branch));
}

function parseDirtyPath(line: string): string {
  if (line.startsWith('?? ') || line.startsWith('!! ')) return line.slice(3).trim();
  if (line.length > 3 && line[2] === ' ') return line.slice(3).trim();
  return line.replace(/^[ MADRCU?!]{1,2}\s+/, '').trim();
}

function isProtectedRuntimeWorkspace(cwd: string, repoRoot: string | null, protectedRoot?: string): boolean {
  const root = repoRoot ? path.resolve(repoRoot) : path.resolve(cwd);
  if (protectedRoot) return root === path.resolve(protectedRoot);
  return path.basename(root) === 'mini-agent';
}

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
  } catch {
    return null;
  }
}
