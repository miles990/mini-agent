#!/usr/bin/env tsx
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { isSafeRuntimeBranch } from '../src/workspace-isolation.js';

interface WorktreeRecord {
  path: string;
  head: string;
  branch: string | null;
}

interface JanitorAction {
  type: 'remove-worktree' | 'delete-local-branch' | 'delete-remote-branch' | 'warn-runtime-branch';
  target: string;
  reason: string;
  command?: string[];
}

const apply = process.argv.includes('--apply');
const json = process.argv.includes('--json');
const repo = readArg('--repo') ?? process.env.MINI_AGENT_GITHUB_REPO ?? 'miles990/mini-agent';
const base = readArg('--base') ?? process.env.MINI_AGENT_BASE_BRANCH ?? 'main';
const localOnly = process.argv.includes('--local-only');
const root = git(['rev-parse', '--show-toplevel']) || process.cwd();
const currentBranch = git(['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown';
const mergedPrBranches = new Set(readMergedPrBranches(repo));
const openPrBranches = new Set(readOpenPrBranches(repo));
const worktrees = readWorktrees();
const protectedRoot = path.resolve(process.env.MINI_AGENT_RUNTIME_WORKSPACE ?? inferRuntimeWorkspace(root));

const actions: JanitorAction[] = [];
const removableWorktreeBranches = new Set<string>();

if (path.resolve(root) === protectedRoot && !isSafeRuntimeBranch(currentBranch)) {
  actions.push({
    type: 'warn-runtime-branch',
    target: currentBranch,
    reason: `protected runtime workspace is on ${currentBranch}; switch it back to runtime/main after preserving local work`,
  });
}

for (const wt of worktrees) {
  if (!wt.branch) continue;
  if (path.resolve(wt.path) === protectedRoot) continue;
  if (wt.branch === base && isDisposableBaseWorktree(wt.path) && isWorktreeClean(wt.path)) {
    removableWorktreeBranches.add(wt.branch);
    actions.push({
      type: 'remove-worktree',
      target: wt.path,
      reason: `clean disposable ${base} worktree blocks future checkout of ${base}`,
      command: ['git', 'worktree', 'remove', wt.path],
    });
    continue;
  }
  if (openPrBranches.has(wt.branch)) continue;
  if ((mergedPrBranches.has(wt.branch) || isMergedToBase(wt.branch, base)) && isWorktreeClean(wt.path)) {
    removableWorktreeBranches.add(wt.branch);
    const githubMerged = mergedPrBranches.has(wt.branch);
    actions.push({
      type: 'remove-worktree',
      target: wt.path,
      reason: githubMerged
        ? `branch ${wt.branch} was merged and worktree is clean`
        : `branch ${wt.branch} is already merged into ${base} and worktree is clean`,
      command: ['git', 'worktree', 'remove', wt.path],
    });
  }
}

for (const branch of readLocalBranches()) {
  if (branch === 'runtime/main') continue;
  if (openPrBranches.has(branch)) continue;
  if (isBranchCheckedOut(branch, worktrees) && !removableWorktreeBranches.has(branch)) continue;
  if (mergedPrBranches.has(branch) || isMergedToBase(branch, base)) {
    const githubMerged = mergedPrBranches.has(branch);
    actions.push({
      type: 'delete-local-branch',
      target: branch,
      reason: githubMerged ? 'PR already merged' : `already merged into ${base}`,
      // Squash merges are not ancestors of main, so -d can reject branches that
      // GitHub has already recorded as merged. Force is scoped to merged PR heads
      // only; normal ancestor cleanup still uses -d.
      command: ['git', 'branch', githubMerged ? '-D' : '-d', branch],
    });
  }
}

if (!localOnly) {
  for (const branch of readRemoteBranches()) {
    if (openPrBranches.has(branch)) continue;
    if (mergedPrBranches.has(branch)) {
      actions.push({
        type: 'delete-remote-branch',
        target: branch,
        reason: 'PR already merged and no open PR uses this head',
        command: ['git', 'push', 'origin', '--delete', branch],
      });
    }
  }
}

if (apply) {
  process.stdout.write(`[workspace-janitor] applying ${actions.length} action(s)\n`);
  for (const action of actions) {
    if (!action.command) continue;
    process.stdout.write(`[workspace-janitor] apply ${action.type}: ${action.target}\n`);
    try {
      execFileSync(action.command[0], action.command.slice(1), {
        cwd: root,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 30_000,
      });
    } catch (error) {
      action.reason += `; apply failed: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`;
      process.stdout.write(`[workspace-janitor] failed ${action.type}: ${action.target} — ${action.reason}\n`);
    }
  }
  git(['worktree', 'prune']);
}

if (json) {
  process.stdout.write(JSON.stringify({ apply, localOnly, root, currentBranch, actions }, null, 2) + '\n');
} else {
  process.stdout.write(`[workspace-janitor] mode=${apply ? 'apply' : 'dry-run'} localOnly=${localOnly} actions=${actions.length}\n`);
  for (const action of actions) {
    process.stdout.write(`- ${action.type}: ${action.target} — ${action.reason}\n`);
  }
}

function readArg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  const prefix = `${name}=`;
  return argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
}

function inferRuntimeWorkspace(repoRoot: string): string {
  const baseName = path.basename(repoRoot);
  if (baseName === 'mini-agent') return repoRoot;
  if (baseName.startsWith('mini-agent-')) return path.join(path.dirname(repoRoot), 'mini-agent');
  return repoRoot;
}

function readMergedPrBranches(repoName: string): string[] {
  try {
    const out = execFileSync('gh', [
      'pr', 'list',
      '--repo', repoName,
      '--state', 'merged',
      '--limit', '100',
      '--json', 'headRefName',
    ], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 });
    return (JSON.parse(out) as Array<{ headRefName: string }>).map(pr => pr.headRefName).filter(Boolean);
  } catch {
    return [];
  }
}

function readOpenPrBranches(repoName: string): string[] {
  try {
    const out = execFileSync('gh', [
      'pr', 'list',
      '--repo', repoName,
      '--state', 'open',
      '--limit', '100',
      '--json', 'headRefName',
    ], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 });
    return (JSON.parse(out) as Array<{ headRefName: string }>).map(pr => pr.headRefName).filter(Boolean);
  } catch {
    return [];
  }
}

function readWorktrees(): WorktreeRecord[] {
  const out = git(['worktree', 'list', '--porcelain']) ?? '';
  const records: WorktreeRecord[] = [];
  let current: Partial<WorktreeRecord> = {};
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) records.push({ path: current.path, head: current.head ?? '', branch: current.branch ?? null });
      current = { path: line.slice('worktree '.length) };
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch refs/heads/')) {
      current.branch = line.slice('branch refs/heads/'.length);
    } else if (line === 'detached') {
      current.branch = null;
    }
  }
  if (current.path) records.push({ path: current.path, head: current.head ?? '', branch: current.branch ?? null });
  return records;
}

function readLocalBranches(): string[] {
  return (git(['for-each-ref', '--format=%(refname:short)', 'refs/heads']) ?? '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);
}

function readRemoteBranches(): string[] {
  return (git(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin']) ?? '')
    .split('\n')
    .map(s => s.trim())
    .filter(s => s && s !== 'origin/HEAD')
    .map(s => s.replace(/^origin\//, ''));
}

function isWorktreeClean(worktreePath: string): boolean {
  return (git(['-C', worktreePath, 'status', '--porcelain']) ?? '').trim().length === 0;
}

function isDisposableBaseWorktree(worktreePath: string): boolean {
  const name = path.basename(worktreePath);
  const runtimeName = path.basename(protectedRoot);
  return name !== runtimeName && name.startsWith(`${runtimeName}-`);
}

function isBranchCheckedOut(branch: string, records: WorktreeRecord[]): boolean {
  return records.some(wt => wt.branch === branch);
}

function isMergedToBase(branch: string, baseBranch: string): boolean {
  const candidates = [`origin/${baseBranch}`, baseBranch];
  for (const candidate of candidates) {
    if (!refExists(candidate)) continue;
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', branch, candidate], {
        cwd: root,
        stdio: 'ignore',
        timeout: 5000,
      });
      return true;
    } catch {
      // Try the next known base ref.
    }
  }
  return false;
}

function refExists(ref: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], {
      cwd: root,
      stdio: 'ignore',
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

function git(args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    }).trim();
  } catch {
    return null;
  }
}
