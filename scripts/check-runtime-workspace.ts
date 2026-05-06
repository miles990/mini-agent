#!/usr/bin/env tsx
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { isCodePath, isRuntimeRepoMemoryPath, isSafeRuntimeBranch, parseDirtyPaths } from '../src/workspace-isolation.js';

const allow = process.env.MINI_AGENT_ALLOW_RUNTIME_WORKSPACE_WRITE === '1';
const json = process.argv.includes('--json');
const stagedOnly = process.argv.includes('--staged');
const cwd = process.cwd();
const repoRoot = git(['rev-parse', '--show-toplevel']) || cwd;
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']) || null;
const protectedRoot = path.resolve(process.env.MINI_AGENT_RUNTIME_WORKSPACE ?? inferRuntimeWorkspace(repoRoot));
const isProtectedRuntime = path.resolve(repoRoot) === protectedRoot;
const paths = stagedOnly ? stagedPaths() : parseDirtyPaths(git(['status', '--porcelain']) ?? '');
const blockingPaths = paths.filter(isCodePath);
const runtimeMemoryPaths = paths.filter(isRuntimeRepoMemoryPath);

const problems: string[] = [];
if (isProtectedRuntime && !isSafeRuntimeBranch(branch)) {
  problems.push(`protected runtime workspace is on ${branch ?? 'unknown'}; expected runtime/main`);
}
if (isProtectedRuntime && blockingPaths.length > 0) {
  problems.push(`protected runtime workspace has code/config changes: ${blockingPaths.slice(0, 8).join(', ')}`);
}
if (isProtectedRuntime && runtimeMemoryPaths.length > 0) {
  problems.push(`protected runtime workspace has repo-local memory changes: ${runtimeMemoryPaths.slice(0, 8).join(', ')}; write memory to MINI_AGENT_MEMORY_DIR instead`);
}

const result = {
  ok: problems.length === 0 || allow,
  allowOverride: allow,
  repoRoot,
  branch,
  protectedRoot,
  isProtectedRuntime,
  stagedOnly,
  paths,
  blockingPaths,
  runtimeMemoryPaths,
  problems,
};

if (json) {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} else if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`[runtime-workspace] ${problem}\n`);
  if (!allow) {
    process.stderr.write('[runtime-workspace] commit blocked. Use an isolated forge worktree, or set MINI_AGENT_ALLOW_RUNTIME_WORKSPACE_WRITE=1 only for intentional recovery.\n');
  }
}

if (!result.ok) process.exit(1);

function stagedPaths(): string[] {
  const out = git(['diff', '--cached', '--name-status', '--diff-filter=ACMR']) ?? '';
  return out
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.split(/\s+/).at(-1) ?? '')
    .filter(Boolean);
}

function inferRuntimeWorkspace(root: string): string {
  const baseName = path.basename(root);
  if (baseName === 'mini-agent') return root;
  if (baseName.startsWith('mini-agent-')) return path.join(path.dirname(root), 'mini-agent');
  return root;
}

function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 8000,
    }).trim();
  } catch {
    return null;
  }
}
