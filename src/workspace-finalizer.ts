import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { slog } from './utils.js';

const execFileAsync = promisify(execFile);
const STATE_PATH = path.join('memory', 'state', 'workspace-finalizer.json');

export type WorkspaceFinalizerStatus =
  | 'main'
  | 'feature-no-pr'
  | 'pending-review'
  | 'scope-contaminated'
  | 'unknown';

export interface WorkspaceCommitSummary {
  sha: string;
  subject: string;
  body?: string;
}

export interface WorkspacePullRequestSummary {
  number: number;
  title: string;
  url?: string;
  state?: string;
  headRefName?: string;
  baseRefName?: string;
}

export interface WorkspaceGitState {
  branch: string | null;
  baseBranch: string;
  dirty: boolean;
  commitsAhead: WorkspaceCommitSummary[];
  pullRequest?: WorkspacePullRequestSummary | null;
}

export interface WorkspaceFinalizerSnapshot {
  checkedAt: string;
  status: WorkspaceFinalizerStatus;
  branch: string | null;
  baseBranch: string;
  dirty: boolean;
  ahead: number;
  pullRequest: WorkspacePullRequestSummary | null;
  issueRefs: number[];
  foreignIssueRefs: number[];
  canAcceptNewScope: boolean;
  shouldReturnToBase: boolean;
  returnBlockedReason: string | null;
  reviewerPolicy: string;
  guidance: string[];
}

export function analyzeWorkspaceState(
  state: WorkspaceGitState,
  now = new Date(),
): WorkspaceFinalizerSnapshot {
  const branch = state.branch;
  const pr = state.pullRequest ?? null;
  const issueRefs = uniqueNumbers(state.commitsAhead.flatMap(c => extractIssueRefs(`${c.subject}\n${c.body ?? ''}`)));
  const foreignIssueRefs = pr ? issueRefs.filter(n => n !== pr.number) : [];
  const onBase = !branch || branch === state.baseBranch;

  let status: WorkspaceFinalizerStatus = 'unknown';
  const guidance: string[] = [];
  let canAcceptNewScope = false;
  let shouldReturnToBase = false;
  let returnBlockedReason: string | null = null;

  if (onBase) {
    status = 'main';
    canAcceptNewScope = !state.dirty;
    if (state.dirty) guidance.push('Base branch is dirty; finish or stash local changes before starting a new code task.');
  } else if (!pr) {
    status = 'feature-no-pr';
    guidance.push(`Current branch ${branch} is not ${state.baseBranch} and has no detected PR; create/attach a PR or return to ${state.baseBranch}.`);
  } else if (foreignIssueRefs.length > 0) {
    status = 'scope-contaminated';
    guidance.push(`Current PR #${pr.number} contains commit refs for other issue(s): ${foreignIssueRefs.map(n => `#${n}`).join(', ')}.`);
    guidance.push('Do not add more unrelated commits to this branch. Split/cherry-pick or merge intentionally, then return to base.');
  } else {
    status = 'pending-review';
    guidance.push(`Current branch is already represented by PR #${pr.number}; wait for review/merge or only amend that exact scope.`);
  }

  if (!onBase) {
    canAcceptNewScope = false;
    shouldReturnToBase = true;
    if (state.dirty) returnBlockedReason = 'dirty-worktree';
    else if (state.commitsAhead.length > 0 && !pr) returnBlockedReason = 'unpushed-or-unreviewed-commits';
  }

  return {
    checkedAt: now.toISOString(),
    status,
    branch,
    baseBranch: state.baseBranch,
    dirty: state.dirty,
    ahead: state.commitsAhead.length,
    pullRequest: pr,
    issueRefs,
    foreignIssueRefs,
    canAcceptNewScope,
    shouldReturnToBase,
    returnBlockedReason,
    reviewerPolicy: 'L2 src changes require peer review by a non-author brain; L3 architecture/scheduler/deploy changes require Alex or explicit multi-brain consensus.',
    guidance,
  };
}

export async function updateWorkspaceFinalizerState(repoRoot = process.cwd()): Promise<WorkspaceFinalizerSnapshot> {
  const snapshot = analyzeWorkspaceState(await readWorkspaceGitState(repoRoot));
  writeWorkspaceFinalizerSnapshot(repoRoot, snapshot);
  if (snapshot.status !== 'main') {
    slog('WORKSPACE', `${snapshot.status}: ${snapshot.guidance[0] ?? snapshot.branch ?? 'feature branch active'}`);
  }
  return snapshot;
}

export function readWorkspaceFinalizerSnapshot(repoRoot = process.cwd()): WorkspaceFinalizerSnapshot | null {
  const file = path.join(repoRoot, STATE_PATH);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as WorkspaceFinalizerSnapshot;
  } catch {
    return null;
  }
}

export function formatWorkspaceConstraint(snapshot: WorkspaceFinalizerSnapshot | null): string {
  if (!snapshot || snapshot.status === 'main') return '';
  const lines = [
    `<workspace-finalizer status="${snapshot.status}" branch="${snapshot.branch ?? 'unknown'}" base="${snapshot.baseBranch}" dirty="${snapshot.dirty}">`,
    `Current branch is not open for new unrelated autonomous code work.`,
    `Reviewer policy: ${snapshot.reviewerPolicy}`,
    ...snapshot.guidance.map(g => `- ${g}`),
  ];
  if (snapshot.pullRequest) {
    lines.push(`PR: #${snapshot.pullRequest.number} ${snapshot.pullRequest.title}`);
  }
  if (snapshot.shouldReturnToBase) {
    lines.push(`Required finalizer: return to ${snapshot.baseBranch} after PR review/merge. Blocker: ${snapshot.returnBlockedReason ?? 'none'}.`);
  }
  lines.push(`Allowed next action: report status, request/review PR, split/cherry-pick scope, or cleanly return workspace. Do not stack a new issue/task on this branch.`);
  lines.push(`</workspace-finalizer>`);
  return lines.join('\n');
}

async function readWorkspaceGitState(repoRoot: string): Promise<WorkspaceGitState> {
  const baseBranch = 'main';
  const branch = (await git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')).trim() || null;
  const dirty = (await git(repoRoot, ['status', '--porcelain']).catch(() => '')).trim().length > 0;
  const commitsAhead = parseCommits(await git(repoRoot, ['log', '--format=%H%x1f%s%x1f%b%x1e', `origin/${baseBranch}..HEAD`]).catch(() => ''));
  const pullRequest = await readCurrentPullRequest(repoRoot);
  return { branch, baseBranch, dirty, commitsAhead, pullRequest };
}

async function readCurrentPullRequest(repoRoot: string): Promise<WorkspacePullRequestSummary | null> {
  try {
    const out = await execFileAsync('gh', ['pr', 'view', '--json', 'number,title,url,state,headRefName,baseRefName'], {
      cwd: repoRoot,
      encoding: 'utf-8',
      timeout: 8000,
    });
    const parsed = JSON.parse(out.stdout) as WorkspacePullRequestSummary;
    return typeof parsed.number === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

async function git(repoRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd: repoRoot,
    encoding: 'utf-8',
    timeout: 8000,
  });
  return stdout;
}

function writeWorkspaceFinalizerSnapshot(repoRoot: string, snapshot: WorkspaceFinalizerSnapshot): void {
  const file = path.join(repoRoot, STATE_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
}

function parseCommits(raw: string): WorkspaceCommitSummary[] {
  return raw.split('\x1e')
    .map(record => record.trim())
    .filter(Boolean)
    .map(record => {
      const [sha, subject, body] = record.split('\x1f');
      return { sha, subject: subject ?? '', body };
    });
}

function extractIssueRefs(text: string): number[] {
  const refs: number[] = [];
  const re = /(?:^|[\s([:,])#(\d+)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) refs.push(Number(m[1]));
  return refs;
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}
