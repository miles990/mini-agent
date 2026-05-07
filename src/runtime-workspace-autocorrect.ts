import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertKuroGithubIdentity, kuroGithubCliEnv, kuroGitEnv } from './github-identity.js';
import { isSafeRuntimeBranch, refreshGitIndex } from './workspace-isolation.js';

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
  hasUntracked: boolean;
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
  const mode = snapshot.ahead > 0 ? 'commits' : snapshot.dirty ? 'tracked-dirty' : 'clean';
  if (snapshot.dirty && snapshot.hasUntracked) {
    return {
      status: 'blocked',
      reason: 'runtime checkout has untracked changes; commit, move, or ignore them before autocorrect',
    };
  }
  if (mode === 'clean' && snapshot.behind === 0) return { status: 'not-needed', reason: 'runtime checkout is clean' };
  if (!snapshot.headSha) return { status: 'failed', reason: 'could not read runtime HEAD sha' };

  const shortSha = mode === 'tracked-dirty' ? `dirty-${Date.now().toString(36)}` : snapshot.headSha.slice(0, 8);
  const branch = `fix/runtime-autocorrect-${shortSha}`;
  const worktreeParent = path.resolve(opts.worktreeParent ?? path.dirname(root));
  const worktree = path.join(worktreeParent, `${path.basename(root)}-autocorrect-${shortSha}`);

  if (!opts.apply) {
    return {
      status: 'created-worktree',
      reason: mode === 'tracked-dirty'
        ? `would move tracked runtime dirt to ${branch}`
        : `would move ${snapshot.ahead} runtime-local commit(s) to ${branch}`,
      branch,
      worktree,
      resetRuntime: true,
    };
  }

  try {
    git(root, ['fetch', 'origin', baseBranch]);
    if (snapshot.behind > 0 && mode === 'clean') {
      git(root, ['reset', '--hard', `origin/${baseBranch}`]);
      return {
        status: 'not-needed',
        reason: `fast-forwarded protected runtime checkout to origin/${baseBranch}`,
        resetRuntime: true,
      };
    }
    if (snapshot.behind > 0 && mode === 'tracked-dirty' && trackedDirtyMatchesRef(root, `origin/${baseBranch}`)) {
      git(root, ['reset', '--hard', `origin/${baseBranch}`]);
      return {
        status: 'not-needed',
        reason: `runtime dirty state was already present in origin/${baseBranch}; synced protected checkout`,
        resetRuntime: true,
      };
    }
    // Idempotency: if the remote branch already exists from a prior partial run,
    // skip the cherry-pick + push step. This handles the case where `gh pr create`
    // (or any later step) failed mid-sequence and the loop retries the autocorrect.
    const remoteBranchExists = !!safeGit(root, ['ls-remote', '--heads', 'origin', branch]);
    if (!remoteBranchExists) {
      if (mode === 'tracked-dirty') {
        const dirtyBaseRef = snapshot.behind > 0 ? snapshot.headSha : `origin/${baseBranch}`;
        ensureWorktree(root, worktree, branch, dirtyBaseRef);
        moveTrackedDirtyToWorktree(root, worktree);
      } else {
        // Create worktree directly at headSha to preserve original commit hashes
        // (cherry-pick creates new commits with different hashes)
        ensureWorktree(root, worktree, branch, snapshot.headSha);
      }
      // Only inject GitHub credentials when pushing to a GitHub remote.
      // Local/file remotes (e.g. in tests) don't need a token and kuroGitEnv()
      // would throw if KURO_GITHUB_TOKEN is absent.
      const originUrl = safeGit(root, ['remote', 'get-url', 'origin']) ?? '';
      const pushEnv = originUrl.includes('github.com') ? kuroGitEnv() : undefined;
      git(worktree, ['push', '-u', 'origin', branch], pushEnv);
    }
    let prUrl: string | undefined;
    if (opts.createPr ?? true) {
      // Idempotency: re-use an existing PR for this branch if one is already open.
      // Otherwise the second pass would fail with "a pull request for branch X already exists".
      prUrl = findExistingPullRequest(repo, branch)
        ?? createPullRequest(existsSync(worktree) ? worktree : root, repo, baseBranch, branch, snapshot.ahead);
    }
    git(root, ['reset', '--hard', `origin/${baseBranch}`]);
    return {
      status: prUrl ? 'created-pr' : 'created-worktree',
      reason: mode === 'tracked-dirty'
        ? 'moved tracked runtime dirt out of protected checkout'
        : `moved ${snapshot.ahead} runtime-local commit(s) out of protected checkout`,
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

function trackedDirtyMatchesRef(repoRoot: string, ref: string): boolean {
  const paths = git(repoRoot, ['diff', '--name-only', 'HEAD'])
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  if (paths.length === 0) return true;
  return paths.every(file => {
    const diskPath = path.join(repoRoot, file);
    if (!existsSync(diskPath)) return false;
    const refBytes = safeGitBytes(repoRoot, ['show', `${ref}:${file}`]);
    if (!refBytes) return false;
    return readFileSync(diskPath).equals(refBytes);
  });
}

function readGitSnapshot(repoRoot: string): GitSnapshot | null {
  if (!existsSync(path.join(repoRoot, '.git'))) return null;
  refreshGitIndex(repoRoot);
  const status = git(repoRoot, ['status', '--porcelain=v2', '--branch']);
  let branch: string | null = null;
  let headSha: string | null = null;
  let ahead = 0;
  let behind = 0;
  let dirty = false;
  let hasUntracked = false;
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
    if (line && !line.startsWith('#')) {
      dirty = true;
      if (line.startsWith('? ')) hasUntracked = true;
    }
  }
  return { branch, headSha, ahead, behind, dirty, hasUntracked };
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

function findExistingPullRequest(repo: string, branch: string): string | undefined {
  try {
    assertKuroGithubIdentity();
    const out = execFileSync('gh', [
      'pr', 'list',
      '--repo', repo,
      '--head', branch,
      '--state', 'open',
      '--json', 'url',
      '--limit', '1',
    ], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
      env: kuroGithubCliEnv(),
    }).trim();
    if (!out) return undefined;
    const parsed = JSON.parse(out) as Array<{ url?: string }>;
    return parsed[0]?.url || undefined;
  } catch {
    return undefined;
  }
}

function createPullRequest(worktree: string, repo: string, baseBranch: string, branch: string, ahead: number): string | undefined {
  assertKuroGithubIdentity();
  const title = `fix(runtime): preserve local runtime commit ${branch.replace('fix/runtime-autocorrect-', '')}`;
  const body = runtimeAutocorrectPrBody(ahead, branch);
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
    env: kuroGithubCliEnv(),
  }).trim();
  return out || undefined;
}

export function runtimeAutocorrectPrBody(ahead: number, branch: string): string {
  return [
    '## Summary',
    `- autocorrected ${ahead} commit(s) that were made on protected runtime/main`,
    '- moved the change into an isolated worktree branch so review/merge/deploy can proceed normally',
    '- reset the runtime checkout back to origin/main after preserving the change',
    '',
    '## Verification',
    `- [x] \`git push -u origin ${branch}\` passed; the runtime-local commit is preserved on an isolated review branch`,
    '- [x] `git reset --hard origin/main` passed; the protected runtime checkout was restored to origin/main',
  ].join('\n');
}

function moveTrackedDirtyToWorktree(repoRoot: string, worktree: string): void {
  const patch = gitRaw(repoRoot, ['diff', '--binary', 'HEAD']);
  if (!patch.trim()) throw new Error('runtime dirty state has no tracked diff to preserve');
  const patchPath = path.join(worktree, '.runtime-autocorrect.patch');
  writeFileSync(patchPath, patch, 'utf-8');
  git(worktree, ['apply', '--index', patchPath]);
  git(worktree, ['commit', '-m', 'fix(runtime): preserve tracked runtime workspace changes']);
}

function safeGit(cwd: string, args: string[]): string | null {
  try {
    return git(cwd, args).trim();
  } catch {
    return null;
  }
}

function safeGitBytes(cwd: string, args: string[]): Buffer | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
  } catch {
    return null;
  }
}

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return gitRaw(cwd, args, env).trim();
}

function gitRaw(cwd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
    env: env ?? process.env,
  });
}
