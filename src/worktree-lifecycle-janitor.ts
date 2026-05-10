import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { appendMemoryIndexEntry, queryMemoryIndexSync, updateMemoryIndexEntry, type MemoryIndexEntry } from './memory-index.js';
import { slog } from './utils.js';

const LEDGER_FILE = 'worktree-lifecycle.jsonl';
const DEFAULT_MAX_QUEUED_PER_SWEEP = 4;
const DEFAULT_MAX_ACTIVE_TASKS = 3;
const DEFAULT_PRIORITY = 2;

type WorktreeBucket =
  | 'open-pr'
  | 'clean-unmerged'
  | 'dirty-unmerged'
  | 'dirty-merged-real-work'
  | 'detached-clean'
  | 'detached-dirty';

interface WorktreeRecord {
  path: string;
  branch: string | null;
  detached: boolean;
}

interface OpenPrRecord {
  number: number;
  title?: string;
  headRefName: string;
  url?: string;
}

export interface WorktreeLifecycleCase {
  id: string;
  path: string;
  branch: string;
  bucket: WorktreeBucket;
  dirty: boolean;
  dirtyPaths: string[];
  ahead: number | null;
  behind: number | null;
  mergedToBase: boolean | null;
  openPr?: OpenPrRecord;
}

export interface WorktreeLifecycleRecord {
  caseId: string;
  path: string;
  branch: string;
  bucket: WorktreeBucket;
  seenAt: string;
  followUpTaskId: string;
}

export interface WorktreeLifecycleSweepResult {
  scanned: number;
  actionable: number;
  queued: number;
  skippedKnown: number;
  held: number;
}

export async function sweepWorktreeLifecycle(
  memoryDir: string,
  options: {
    root?: string;
    baseBranch?: string;
    worktrees?: WorktreeRecord[];
    openPrs?: OpenPrRecord[];
    now?: Date;
    maxQueuedPerSweep?: number;
    maxActiveTasks?: number;
  } = {},
): Promise<WorktreeLifecycleSweepResult> {
  const root = options.root ?? git(['rev-parse', '--show-toplevel'], process.cwd()) ?? process.cwd();
  const baseBranch = options.baseBranch ?? 'main';
  const openPrs = options.openPrs ?? readOpenPrs(root);
  const worktrees = options.worktrees ?? readWorktrees(root);
  const cases = classifyWorktrees(root, worktrees, openPrs, baseBranch);
  return queueWorktreeLifecycleTasks(memoryDir, cases, options.now ?? new Date(), options);
}

export function classifyWorktrees(
  root: string,
  worktrees: WorktreeRecord[],
  openPrs: OpenPrRecord[],
  baseBranch = 'main',
): WorktreeLifecycleCase[] {
  const rootPath = path.resolve(root);
  const openPrByBranch = new Map(openPrs.map(pr => [pr.headRefName, pr]));
  const cases: WorktreeLifecycleCase[] = [];

  for (const wt of worktrees) {
    if (path.resolve(wt.path) === rootPath) continue;
    if (!existsSync(wt.path)) continue;

    const dirtyPaths = readDirtyPaths(wt.path);
    const dirty = dirtyPaths.length > 0;
    const branch = wt.branch ?? '(detached)';
    const openPr = wt.branch ? openPrByBranch.get(wt.branch) : undefined;
    const mergedToBase = wt.branch ? isMergedToBase(root, wt.branch, baseBranch) : null;
    const counts = wt.branch ? aheadBehind(root, wt.branch, baseBranch) : { ahead: null, behind: null };

    let bucket: WorktreeBucket | null = null;
    if (openPr) bucket = 'open-pr';
    else if (wt.detached || !wt.branch) bucket = dirty ? 'detached-dirty' : 'detached-clean';
    else if (dirty && mergedToBase) bucket = 'dirty-merged-real-work';
    else if (dirty) bucket = 'dirty-unmerged';
    else if (!mergedToBase) bucket = 'clean-unmerged';

    if (!bucket || bucket === 'open-pr') continue;

    cases.push({
      id: stableCaseId(wt.path, branch, bucket),
      path: wt.path,
      branch,
      bucket,
      dirty,
      dirtyPaths,
      ahead: counts.ahead,
      behind: counts.behind,
      mergedToBase,
      openPr,
    });
  }
  return cases.sort((a, b) => `${a.bucket}:${a.branch}:${a.path}`.localeCompare(`${b.bucket}:${b.branch}:${b.path}`));
}

export async function queueWorktreeLifecycleTasks(
  memoryDir: string,
  cases: WorktreeLifecycleCase[],
  now = new Date(),
  options: { maxQueuedPerSweep?: number; maxActiveTasks?: number } = {},
): Promise<WorktreeLifecycleSweepResult> {
  const known = new Set(readWorktreeLifecycleRecords(memoryDir).map(record => record.caseId));
  const result: WorktreeLifecycleSweepResult = {
    scanned: cases.length,
    actionable: cases.length,
    queued: 0,
    skippedKnown: 0,
    held: 0,
  };

  const maxActive = options.maxActiveTasks ?? DEFAULT_MAX_ACTIVE_TASKS;
  result.held += await rebalanceActiveTasks(memoryDir, maxActive);
  const activeBudget = Math.max(0, maxActive - countActiveTasks(memoryDir));
  const queueBudget = Math.min(options.maxQueuedPerSweep ?? DEFAULT_MAX_QUEUED_PER_SWEEP, activeBudget);

  for (const item of cases) {
    if (known.has(item.id)) {
      result.skippedKnown++;
      continue;
    }
    if (result.queued >= queueBudget) continue;
    const followUpTaskId = await ensureWorktreeFollowUpTask(memoryDir, item, now);
    appendLifecycleRecord(memoryDir, {
      caseId: item.id,
      path: item.path,
      branch: item.branch,
      bucket: item.bucket,
      seenAt: now.toISOString(),
      followUpTaskId,
    });
    known.add(item.id);
    result.queued++;
  }

  if (result.queued > 0 || result.held > 0) {
    slog('WORKTREE-LIFECYCLE', `queued=${result.queued}/${result.actionable} held=${result.held} known=${result.skippedKnown}`);
  }
  return result;
}

export function getWorktreeLifecyclePath(memoryDir: string): string {
  return path.join(memoryDir, 'index', LEDGER_FILE);
}

export function readWorktreeLifecycleRecords(memoryDir: string): WorktreeLifecycleRecord[] {
  const filePath = ensureLedger(memoryDir);
  const latest = new Map<string, WorktreeLifecycleRecord>();
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const raw = JSON.parse(trimmed) as WorktreeLifecycleRecord;
      if (!raw.caseId || !raw.path || !raw.branch || !raw.bucket || !raw.seenAt || !raw.followUpTaskId) continue;
      latest.set(raw.caseId, raw);
    } catch {
      continue;
    }
  }
  return [...latest.values()].sort((a, b) => b.seenAt.localeCompare(a.seenAt));
}

async function ensureWorktreeFollowUpTask(memoryDir: string, item: WorktreeLifecycleCase, now: Date): Promise<string> {
  const existing = getLifecycleTasks(memoryDir, ['pending', 'in_progress', 'hold'])
    .find(entry => (entry.payload ?? {}).worktree_case_id === item.id);
  if (existing) return existing.id;

  const entry = await appendMemoryIndexEntry(memoryDir, {
    type: 'task',
    status: 'pending',
    summary: `WT ${shortCaseHash(item.id)} ${item.bucket}: ${item.branch}`,
    refs: [item.path],
    tags: ['workspace', 'worktree-lifecycle', item.bucket],
    payload: {
      origin: 'worktree-lifecycle-janitor',
      priority: DEFAULT_PRIORITY,
      worktree_case_id: item.id,
      worktree_path: item.path,
      worktree_branch: item.branch,
      worktree_bucket: item.bucket,
      dirty_paths: item.dirtyPaths.slice(0, 20),
      ahead: item.ahead,
      behind: item.behind,
      merged_to_base: item.mergedToBase,
      acceptance_criteria: acceptanceFor(item),
      createdAt: now.toISOString(),
    },
  });
  return entry.id;
}

function acceptanceFor(item: WorktreeLifecycleCase): string {
  if (item.bucket === 'clean-unmerged') return 'Open a PR, intentionally drop the branch with evidence, or merge/absorb the branch into current main.';
  if (item.bucket === 'dirty-unmerged') return 'Preserve real work as a PR or explicit patch note, or prove the dirty artifact is disposable before cleanup.';
  if (item.bucket === 'dirty-merged-real-work') return 'Compare dirty changes against main, preserve any new value, then clean/remove the worktree.';
  if (item.bucket === 'detached-clean') return 'Remove the detached verification worktree once no linked open PR or active task needs it.';
  return 'Diagnose the detached dirty worktree and preserve or explicitly drop its changes.';
}

function readOpenPrs(root: string): OpenPrRecord[] {
  try {
    const out = execFileSync('gh', [
      'pr', 'list',
      '--state', 'open',
      '--limit', '100',
      '--json', 'number,title,headRefName,url',
    ], { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15_000 });
    return JSON.parse(out) as OpenPrRecord[];
  } catch {
    return [];
  }
}

function readWorktrees(root: string): WorktreeRecord[] {
  const out = git(['worktree', 'list', '--porcelain'], root) ?? '';
  const records: WorktreeRecord[] = [];
  let current: Partial<WorktreeRecord> = {};
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (current.path) records.push({ path: current.path, branch: current.branch ?? null, detached: current.detached ?? false });
      current = { path: line.slice('worktree '.length), detached: false };
    } else if (line.startsWith('branch refs/heads/')) {
      current.branch = line.slice('branch refs/heads/'.length);
    } else if (line === 'detached') {
      current.detached = true;
      current.branch = null;
    }
  }
  if (current.path) records.push({ path: current.path, branch: current.branch ?? null, detached: current.detached ?? false });
  return records;
}

function readDirtyPaths(worktreePath: string): string[] {
  return (git(['-C', worktreePath, 'status', '--porcelain'], process.cwd()) ?? '')
    .split('\n')
    .map(line => line.slice(3).trim())
    .filter(Boolean);
}

function aheadBehind(root: string, branch: string, baseBranch: string): { ahead: number | null; behind: number | null } {
  const base = refExists(root, `origin/${baseBranch}`) ? `origin/${baseBranch}` : baseBranch;
  try {
    const [behind, ahead] = execFileSync('git', ['rev-list', '--left-right', '--count', `${base}...${branch}`], {
      cwd: root,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim().split(/\s+/).map(Number);
    return { ahead, behind };
  } catch {
    return { ahead: null, behind: null };
  }
}

function isMergedToBase(root: string, branch: string, baseBranch: string): boolean {
  const candidates = [`origin/${baseBranch}`, baseBranch];
  for (const candidate of candidates) {
    if (!refExists(root, candidate)) continue;
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

function refExists(root: string, ref: string): boolean {
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

async function rebalanceActiveTasks(memoryDir: string, maxActive: number): Promise<number> {
  const active = getLifecycleTasks(memoryDir, ['pending', 'in_progress'])
    .sort((a, b) => a.ts.localeCompare(b.ts));
  let held = 0;
  for (const [index, entry] of active.entries()) {
    if (index < maxActive) continue;
    await updateMemoryIndexEntry(memoryDir, entry.id, {
      status: 'hold',
      payload: {
        ...(entry.payload ?? {}),
        priority: DEFAULT_PRIORITY,
        hold_reason: `worktree lifecycle lane capped at ${maxActive} active task(s)`,
      },
    });
    held++;
  }
  return held;
}

function countActiveTasks(memoryDir: string): number {
  return getLifecycleTasks(memoryDir, ['pending', 'in_progress']).length;
}

function getLifecycleTasks(memoryDir: string, statuses: Array<'pending' | 'in_progress' | 'hold'>): MemoryIndexEntry[] {
  return queryMemoryIndexSync(memoryDir, { type: ['task'], status: statuses })
    .filter(entry => (entry.payload ?? {}).origin === 'worktree-lifecycle-janitor');
}

function appendLifecycleRecord(memoryDir: string, record: WorktreeLifecycleRecord): void {
  appendFileSync(ensureLedger(memoryDir), JSON.stringify(record) + '\n', 'utf-8');
}

function ensureLedger(memoryDir: string): string {
  const indexDir = path.join(memoryDir, 'index');
  mkdirSync(indexDir, { recursive: true });
  const filePath = path.join(indexDir, LEDGER_FILE);
  if (!existsSync(filePath)) appendFileSync(filePath, '', 'utf-8');
  return filePath;
}

function stableCaseId(worktreePath: string, branch: string, bucket: string): string {
  return `worktree:${bucket}:${branch}:${worktreePath}`;
}

function shortCaseHash(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 8);
}

function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    }).trim();
  } catch {
    return null;
  }
}
