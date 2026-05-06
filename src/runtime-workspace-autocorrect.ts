import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { isSafeRuntimeBranch } from './workspace-isolation.js';

export type RuntimeAutocorrectStatus =
  | 'not-needed'
  | 'created-pr'
  | 'created-worktree'
  | 'blocked'
  | 'failed';

export interface RuntimeAutocorrectResult {
  status: RuntimeAutocorrectStatus;
  reason: string;
  branch?: string;
  worktree?: string;
  prUrl?: string;
  resetRuntime?: boolean;
}

interface GitSnapshot {
  branch: string | null;
  headSha: string | null;
  ahead: number;
  behind: number;
  dirty: boolean;
}

export function autocorrectRuntimeWorkspace(repoRoot = process.cwd(), opts: {
  apply?: boolean;
  repo?: string;
  baseBranch?: string;
  worktreeParent?: string;
  createPr?: boolean;
} = {}): RuntimeAutocorrectResult {
  const root = path.resolve(repoRoot);
  const baseBranch = opts.baseBranch ?? 'main';
  const repo = opts.repo ?? process.env.MINI_AGENT_GITHUB_REPO ?? 'miles990/mini-agent';
  const snapshot = readGitSnapshot(root);

  if (!snapshot) return { status: 'not-needed', reason: 'not a git repository' };
  if (!isSafeRuntimeBranch(snapshot.branch)) {
    return {
      status: 'blocked',
      reason: `runtime checkout is on ${snapshot.branch ?? 'unknown'}; expected runtime/main before autocorrect`,
    };
  }
  if (snapshot.behind > 0) {
    return {
      status: 'blocked',
      reason: `runtime checkout is behind origin/${baseBranch}; sync base before autocorrect`,
    };
  }
  if (snapshot.dirty) {
    return {
      status: 'blocked',
      reason: 'runtime checkout has uncommitted changes; preserve them manually or commit before autocorrect',
    };
  }
  if (snapshot.ahead <= 0) return { status: 'not-needed', reason: 'runtime checkout is clean' };
  if (!snapshot.headSha) return { status: 'failed', reason: 'could not read runtime HEAD sha' };

  const shortSha = snapshot.headSha.slice(0, 8);
  const branch = `fix/runtime-autocorrect-${shortSha}`;
  const worktreeParent = path.resolve(opts.worktreeParent ?? path.dirname(root));
  const worktree = path.join(worktreeParent, `${path.basename(root)}-autocorrect-${shortSha}`);

  if (!opts.apply) {
    return {
      status: 'created-worktree',
      reason: `would move ${snapshot.ahead} runtime-local commit(s) to ${branch}`,
      branch,
      worktree,
      resetRuntime: true,
    };
  }

  try {
    git(root, ['fetch', 'origin', baseBranch]);
    ensureWorktree(root, worktree, branch, `origin/${baseBranch}`);
    git(worktree, ['cherry-pick', `origin/${baseBranch}..${snapshot.headSha}`]);
    git(worktree, ['push', '-u', 'origin', branch]);
    let prUrl: string | undefined;
    if (opts.createPr ?? true) {
      prUrl = createPullRequest(worktree, repo, baseBranch, branch, snapshot.ahead);
    }
    git(root, ['reset', '--hard', `origin/${baseBranch}`]);
    return {
      status: prUrl ? 'created-pr' : 'created-worktree',
      reason: `moved ${snapshot.ahead} runtime-local commit(s) out of protected checkout`,
      branch,
      worktree,
      prUrl,
      resetRuntime: true,
    };
  } catch (error) {
    return {
      status: 'failed',
      reason: error instanceof Error ? error.message.split('\n')[0] : String(error),
      branch,
      worktree,
    };
  }
}

function readGitSnapshot(repoRoot: string): GitSnapshot | null {
  if (!existsSync(path.join(repoRoot, '.git'))) return null;
  const status = git(repoRoot, ['status', '--porcelain=v2', '--branch']);
  let branch: string | null = null;
  let headSha: string | null = null;
  let ahead = 0;
  let behind = 0;
  let dirty = false;
  for (const line of status.split('\n')) {
    if (line.startsWith('# branch.head ')) branch = line.slice('# branch.head '.length).trim();
    if (line.startsWith('# branch.oid ')) {
      const oid = line.slice('# branch.oid '.length).trim();
      headSha = oid && oid !== '(initial)' ? oid : null;
    }
    if (line.startsWith('# branch.ab ')) {
      ahead = Number(line.match(/\+(\d+)/)?.[1] ?? 0);
      behind = Number(line.match(/-(\d+)/)?.[1] ?? 0);
    }
    if (line && !line.startsWith('#')) dirty = true;
  }
  return { branch, headSha, ahead, behind, dirty };
}

function ensureWorktree(repoRoot: string, worktree: string, branch: string, baseRef: string): void {
  if (existsSync(worktree)) {
    const existingBranch = safeGit(worktree, ['rev-parse', '--abbrev-ref', 'HEAD']);
    if (existingBranch === branch) return;
    throw new Error(`autocorrect worktree already exists with branch ${existingBranch ?? 'unknown'}: ${worktree}`);
  }
  mkdirSync(path.dirname(worktree), { recursive: true });
  git(repoRoot, ['worktree', 'add', worktree, '-b', branch, baseRef]);
}

function createPullRequest(worktree: string, repo: string, baseBranch: string, branch: string, ahead: number): string | undefined {
  const title = `fix(runtime): preserve local runtime commit ${branch.replace('fix/runtime-autocorrect-', '')}`;
  const body = [
    '## Summary',
    `- autocorrected ${ahead} commit(s) that were made on protected runtime/main`,
    '- moved the change into an isolated worktree branch so review/merge/deploy can proceed normally',
    '- reset the runtime checkout back to origin/main after preserving the change',
    '',
    '## Verification',
    '- pending isolated PR review',
  ].join('\n');
  const out = execFileSync('gh', [
    'pr', 'create',
    '--repo', repo,
    '--base', baseBranch,
    '--head', branch,
    '--title', title,
    '--body', body,
  ], {
    cwd: worktree,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
  }).trim();
  return out || undefined;
}

function safeGit(cwd: string, args: string[]): string | null {
  try {
    return git(cwd, args).trim();
  } catch {
    return null;
  }
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  }).trim();
}
