import { execFileSync } from 'node:child_process';
import { appendMemoryIndexEntry, queryMemoryIndexSync, updateMemoryIndexEntry, type MemoryIndexEntry } from './memory-index.js';
import { slog } from './utils.js';

export interface GitHubIssueSummary {
  number: number;
  title: string;
  url?: string;
  state?: 'OPEN' | 'CLOSED' | string;
  body?: string;
  labels?: Array<{ name: string } | string>;
  assignees?: Array<{ login: string } | string>;
  createdAt?: string;
  updatedAt?: string;
}

export interface IssueAutopilotSyncOptions {
  repo: string;
  now?: Date;
  dryRun?: boolean;
}

export interface IssueTaskPlan {
  id: string;
  repo: string;
  issueNumber: number;
  title: string;
  priority: number;
  summary: string;
  labels: string[];
  verifyCommand: string;
  url: string;
}

export interface IssueAutopilotSyncResult {
  scanned: number;
  created: number;
  updated: number;
  closed: number;
  skipped: number;
  plans: IssueTaskPlan[];
}

const TERMINAL_TASK_STATUSES = new Set(['completed', 'done', 'deleted']);

export function issueTaskId(repo: string, issueNumber: number): string {
  return `idx-github-issue-${repo.replace(/[^a-zA-Z0-9]+/g, '-')}-${issueNumber}`;
}

export function planIssueTask(issue: GitHubIssueSummary, options: IssueAutopilotSyncOptions): IssueTaskPlan {
  const labels = normalizeLabels(issue.labels);
  const priority = classifyIssuePriority(issue, labels);
  const repo = options.repo;
  const title = issue.title.trim();
  const url = issue.url ?? `https://github.com/${repo}/issues/${issue.number}`;

  return {
    id: issueTaskId(repo, issue.number),
    repo,
    issueNumber: issue.number,
    title,
    priority,
    labels,
    url,
    summary: `P${priority} GitHub issue #${issue.number}: ${title}`,
    verifyCommand: [
      `gh issue view ${issue.number} --repo ${repo} --json state,title,labels`,
      'pnpm typecheck',
      'pnpm test',
    ].join(' && '),
  };
}

export async function syncGitHubIssuesToTasks(
  memoryDir: string,
  issues: GitHubIssueSummary[],
  options: IssueAutopilotSyncOptions,
): Promise<IssueAutopilotSyncResult> {
  const validIssues = issues
    .filter(issue => Number.isInteger(issue.number) && issue.number > 0 && issue.title.trim().length > 0);
  const openIssues = validIssues.filter(issue => (issue.state ?? 'OPEN').toUpperCase() !== 'CLOSED');
  const closedIssues = validIssues.filter(issue => (issue.state ?? 'OPEN').toUpperCase() === 'CLOSED');
  const plans = openIssues.map(issue => planIssueTask(issue, options));

  let created = 0;
  let updated = 0;
  let closed = 0;
  let skipped = 0;

  // Reconcile: GitHub-closed issues whose local task entry is still pending/in_progress.
  // Without this, closed issues stay rendered as P0 forever (root cause of stale task queue).
  for (const issue of closedIssues) {
    const id = issueTaskId(options.repo, issue.number);
    const existing = queryMemoryIndexSync(memoryDir, { id, limit: 1 })[0];
    if (!existing) { skipped++; continue; }
    if (TERMINAL_TASK_STATUSES.has(String(existing.status))) { skipped++; continue; }
    if (options.dryRun) { closed++; continue; }
    await updateMemoryIndexEntry(memoryDir, existing.id, {
      status: 'completed',
      payload: {
        ...(existing.payload ?? {}),
        closed_via: 'issue-autopilot-reconciliation',
        github_state: 'CLOSED',
        closed_at: (options.now ?? new Date()).toISOString(),
      },
    });
    closed++;
  }

  for (const plan of plans) {
    const existing = queryMemoryIndexSync(memoryDir, { id: plan.id, limit: 1 })[0];
    if (existing && TERMINAL_TASK_STATUSES.has(String(existing.status))) {
      skipped++;
      continue;
    }

    if (options.dryRun) {
      if (existing) updated++;
      else created++;
      continue;
    }

    const payload = buildPayload(plan, options.now ?? new Date());
    if (existing) {
      const changed = await updateExistingIssueTask(memoryDir, existing, plan, payload);
      if (changed) updated++;
      else skipped++;
      continue;
    }

    await appendMemoryIndexEntry(memoryDir, {
      id: plan.id,
      type: 'task',
      status: 'pending',
      source: 'github-issue',
      summary: plan.summary,
      refs: [plan.url],
      tags: ['github', 'issue', `issue:${plan.issueNumber}`, `P${plan.priority}`, ...plan.labels.map(l => `label:${l}`)],
      payload,
    });
    created++;
  }

  const result = { scanned: issues.length, created, updated, closed, skipped, plans };
  slog('ISSUE-AUTOPILOT', `scanned=${result.scanned} created=${created} updated=${updated} closed=${closed} skipped=${skipped}`);
  return result;
}

export function readOpenIssuesFromGitHub(repo: string, limit = 50): GitHubIssueSummary[] {
  const output = execFileSync('gh', [
    'issue',
    'list',
    '--repo',
    repo,
    '--state',
    'all',
    '--limit',
    String(limit),
    '--json',
    'number,title,url,state,labels,assignees,createdAt,updatedAt',
  ], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
  });
  return JSON.parse(output) as GitHubIssueSummary[];
}

export function detectGitHubRepo(cwd = process.cwd()): string | undefined {
  try {
    const url = execFileSync('git', ['config', '--get', 'remote.origin.url'], {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
    return parseGitHubRepoUrl(url);
  } catch {
    return undefined;
  }
}

function parseGitHubRepoUrl(url: string): string | undefined {
  const match = url.match(/github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?$/);
  return match?.[1];
}

function normalizeLabels(labels: GitHubIssueSummary['labels']): string[] {
  return (labels ?? [])
    .map(label => typeof label === 'string' ? label : label.name)
    .filter((label): label is string => Boolean(label))
    .map(label => label.toLowerCase().trim())
    .filter(Boolean);
}

function classifyIssuePriority(issue: GitHubIssueSummary, labels: string[]): number {
  const haystack = `${issue.title}\n${issue.body ?? ''}\n${labels.join(' ')}`.toLowerCase();
  if (
    labels.some(label => /(^|\b)(p0|critical|security)(\b|$)/.test(label)) ||
    /\b(p0|critical|security|credential|token leak|deploy failed|ci failed|production down)\b/.test(haystack)
  ) {
    return 0;
  }
  if (
    labels.some(label => /(^|\b)(p1|bug|fix|regression)(\b|$)/.test(label)) ||
    /\b(bug|fail(?:ed|ure|ures|s)?|regression|broken|conflict|merge|review|autonomous|self[- ]?heal|silent|unresolved|stuck|blocked|expired|backlog|clogging)\b/.test(haystack)
  ) {
    return 1;
  }
  return 2;
}

function buildPayload(plan: IssueTaskPlan, now: Date): Record<string, unknown> {
  return {
    origin: 'github-issue',
    priority: plan.priority,
    assignee: 'kuro',
    repo: plan.repo,
    issue_number: plan.issueNumber,
    issue_url: plan.url,
    issue_labels: plan.labels,
    verify_command: plan.verifyCommand,
    acceptance_criteria: [
      `Issue #${plan.issueNumber} is addressed with code/docs/tests as appropriate.`,
      'Verification evidence is attached to the PR or task report.',
      'Issue is closed only after the fix is merged or explicitly marked obsolete.',
    ].join(' '),
    synced_at: now.toISOString(),
  };
}

async function updateExistingIssueTask(
  memoryDir: string,
  existing: MemoryIndexEntry,
  plan: IssueTaskPlan,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const existingPayload = (existing.payload ?? {}) as Record<string, unknown>;
  const nextPayload = {
    ...existingPayload,
    ...payload,
    first_seen_at: existingPayload.first_seen_at ?? existing.ts,
  };
  const needsUpdate =
    existing.summary !== plan.summary ||
    existing.status === 'abandoned' ||
    existingPayload.priority !== plan.priority ||
    existingPayload.issue_url !== plan.url ||
    JSON.stringify(existingPayload.issue_labels ?? []) !== JSON.stringify(plan.labels);

  if (!needsUpdate) return false;

  await updateMemoryIndexEntry(memoryDir, existing.id, {
    status: existing.status === 'abandoned' ? 'pending' : existing.status,
    source: 'github-issue',
    summary: plan.summary,
    refs: [plan.url],
    tags: ['github', 'issue', `issue:${plan.issueNumber}`, `P${plan.priority}`, ...plan.labels.map(l => `label:${l}`)],
    payload: nextPayload,
  });
  return true;
}
