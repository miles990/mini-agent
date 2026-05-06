export interface CommitSummary {
  sha: string;
  subject: string;
  body?: string;
}

export interface PullRequestSummary {
  number: number;
  title: string;
  body?: string | null;
  reviewDecision?: string | null;
  reviewRequests?: unknown[];
}

export interface OpenPullRequestSummary extends PullRequestSummary {
  authorLogin?: string | null;
  labels?: string[];
  isDraft?: boolean;
}

export type PrReviewer = 'codex' | 'claude-code' | 'akari' | 'alex';
export type PrReviewFramework =
  | 'code-review'
  | 'tanren-review'
  | 'internal-governance'
  | 'human-escalation'
  | 'standard-peer';

export interface ReviewAssignmentDecision {
  needsAssignment: boolean;
  reviewer: PrReviewer;
  reviewers: PrReviewer[];
  framework: PrReviewFramework;
  reason: string;
  status: 'ready' | 'draft' | 'hold' | 'already-has-reviewer' | 'already-reviewed';
}

export interface MergedPullRequestSummary {
  number: number;
  title: string;
  mergedAt?: string | null;
}

export interface HandoffClosureResult {
  content: string;
  updated: number;
  appended: number;
}

export type PrConflictAction = 'none' | 'attempt-update-branch' | 'needs-decomposition' | 'needs-verification';

export interface PrConflictInput {
  number: number;
  title: string;
  body?: string | null;
  mergeable?: string | null;
  reviewDecision?: string | null;
  labels?: string[];
  isDraft?: boolean;
  changedFiles: string[];
}

export interface PrConflictDecision {
  action: PrConflictAction;
  reason: string;
  risk: 'low' | 'medium' | 'high';
}

export interface BranchLifecycleInput {
  branch: string | null;
  baseBranch: string;
  dirty: boolean;
  commitsAhead: CommitSummary[];
  pullRequest?: PullRequestSummary | null;
}

export type BranchLifecycleStatus =
  | 'base'
  | 'feature-no-pr'
  | 'pending-review'
  | 'scope-contaminated';

export interface BranchLifecycleAnalysis {
  status: BranchLifecycleStatus;
  branch: string | null;
  baseBranch: string;
  dirty: boolean;
  ahead: number;
  pullRequest: PullRequestSummary | null;
  issueRefs: number[];
  allowedIssueRefs: number[];
  foreignIssueRefs: number[];
  hasReviewerSignal: boolean;
  canAcceptNewScope: boolean;
  shouldBlockPush: boolean;
  guidance: string[];
}

const ISSUE_REF_RE = /(?:^|[^\w-])(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#(\d+)\b/g;
const RESOLUTION_REF_RE = /(?:^|\n)\s*(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?|implement(?:s|ed)?|refs?)\s+#(\d+)\b/gi;

export function analyzeBranchLifecycle(input: BranchLifecycleInput): BranchLifecycleAnalysis {
  const pr = input.pullRequest ?? null;
  const onBase = !input.branch || input.branch === input.baseBranch;
  const issueRefs = uniqueNumbers(input.commitsAhead.flatMap(c => extractIssueRefs(`${c.subject}\n${c.body ?? ''}`)));
  const allowedIssueRefs = pr ? extractAllowedIssueRefs(pr) : [];
  const foreignIssueRefs = pr
    ? issueRefs.filter(ref => !allowedIssueRefs.includes(ref))
    : [];
  const hasReviewerSignal = Boolean(
    pr &&
    (
      (pr.reviewDecision && pr.reviewDecision.length > 0) ||
      (Array.isArray(pr.reviewRequests) && pr.reviewRequests.length > 0)
    ),
  );

  const guidance: string[] = [];
  let status: BranchLifecycleStatus;
  let shouldBlockPush = false;

  if (onBase) {
    status = 'base';
    if (input.dirty) guidance.push('Base branch is dirty; finish or stash local changes before starting new work.');
  } else if (!pr) {
    status = 'feature-no-pr';
    guidance.push(`Branch ${input.branch} has no detected PR. Open a PR before treating it as complete.`);
  } else if (foreignIssueRefs.length > 0) {
    status = 'scope-contaminated';
    shouldBlockPush = true;
    guidance.push(`PR #${pr.number} allows ${formatRefs(allowedIssueRefs)} but commits reference foreign issue(s): ${formatRefs(foreignIssueRefs)}.`);
    guidance.push('Split/cherry-pick unrelated commits into their own branch before pushing.');
  } else {
    status = 'pending-review';
    guidance.push(`PR #${pr.number} is the active scope. Only amend this PR scope; do not start a new task on this branch.`);
    if (!hasReviewerSignal) {
      guidance.push('No reviewer signal found. A PR without reviewer/review decision is not complete.');
    }
  }

  return {
    status,
    branch: input.branch,
    baseBranch: input.baseBranch,
    dirty: input.dirty,
    ahead: input.commitsAhead.length,
    pullRequest: pr,
    issueRefs,
    allowedIssueRefs,
    foreignIssueRefs,
    hasReviewerSignal,
    canAcceptNewScope: status === 'base' && !input.dirty,
    shouldBlockPush,
    guidance,
  };
}

export function extractIssueRefs(text: string): number[] {
  const refs: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = ISSUE_REF_RE.exec(text)) !== null) refs.push(Number(m[1]));
  return uniqueNumbers(refs);
}

export function extractAllowedIssueRefs(pr: PullRequestSummary): number[] {
  const refs = new Set<number>([pr.number]);
  for (const ref of extractIssueRefs(pr.title)) refs.add(ref);

  const text = `${pr.title}\n${pr.body ?? ''}`;
  let m: RegExpExecArray | null;
  while ((m = RESOLUTION_REF_RE.exec(text)) !== null) refs.add(Number(m[1]));
  return [...refs].sort((a, b) => a - b);
}

export function parseGitLogRecords(raw: string): CommitSummary[] {
  return raw.split('\x1e')
    .map(record => record.trim())
    .filter(Boolean)
    .map(record => {
      const [sha, subject, body] = record.split('\x1f');
      return { sha, subject: subject ?? '', body };
    });
}

export function decidePrReviewAssignment(pr: OpenPullRequestSummary): ReviewAssignmentDecision {
  const labels = new Set((pr.labels ?? []).map(l => l.toLowerCase()));
  if (pr.isDraft) {
    return {
      needsAssignment: false,
      reviewer: 'codex',
      reviewers: ['codex'],
      framework: 'code-review',
      reason: 'draft PR is not ready for review',
      status: 'draft',
    };
  }
  if (labels.has('hold')) {
    return {
      needsAssignment: false,
      reviewer: 'codex',
      reviewers: ['codex'],
      framework: 'code-review',
      reason: 'hold label blocks automated review assignment',
      status: 'hold',
    };
  }
  if (pr.reviewDecision && pr.reviewDecision.length > 0) {
    const assignment = pickReviewAssignment(pr);
    return {
      needsAssignment: false,
      reviewer: assignment.reviewers[0],
      reviewers: assignment.reviewers,
      framework: assignment.framework,
      reason: `review decision already present: ${pr.reviewDecision}`,
      status: 'already-reviewed',
    };
  }
  if (Array.isArray(pr.reviewRequests) && pr.reviewRequests.length > 0) {
    const assignment = pickReviewAssignment(pr);
    return {
      needsAssignment: false,
      reviewer: assignment.reviewers[0],
      reviewers: assignment.reviewers,
      framework: assignment.framework,
      reason: 'reviewer already requested',
      status: 'already-has-reviewer',
    };
  }

  const assignment = pickReviewAssignment(pr);
  return {
    needsAssignment: true,
    reviewer: assignment.reviewers[0],
    reviewers: assignment.reviewers,
    framework: assignment.framework,
    reason: `${riskClass(pr)} PR has no reviewer signal; assign ${assignment.framework}`,
    status: 'ready',
  };
}

export function closeMergedPrHandoffs(
  activeContent: string,
  prs: MergedPullRequestSummary[],
  today: string,
): HandoffClosureResult {
  let content = activeContent.trimEnd();
  let updated = 0;
  let appended = 0;

  for (const pr of prs) {
    const marker = `PR #${pr.number}`;
    const lines = content.split('\n');
    let found = false;

    const nextLines = lines.map(line => {
      if (!line.includes(marker) || !line.trim().startsWith('|')) return line;
      found = true;

      const cols = line.split('|');
      if (cols.length < 8) return line;

      const status = cols[4].trim().toLowerCase();
      const done = cols[6].trim();
      if (['done', 'merged', 'completed'].includes(status) && done !== '-' && done !== '—') return line;

      cols[4] = ' merged ';
      cols[6] = ` ${today} `;
      updated++;
      return cols.join('|');
    });

    content = nextLines.join('\n');
    if (!found) {
      content += `\n| github | kuro | ${marker} ${escapeHandoffTableText(pr.title)} | merged | ${today} | ${today} |`;
      appended++;
    }
  }

  return { content: content + '\n', updated, appended };
}

export function decidePrConflictAction(pr: PrConflictInput): PrConflictDecision {
  const labels = new Set((pr.labels ?? []).map(l => l.toLowerCase()));
  if (pr.mergeable !== 'CONFLICTING') {
    return { action: 'none', risk: 'low', reason: 'PR is not currently marked conflicting' };
  }
  if (pr.isDraft || labels.has('hold')) {
    return { action: 'none', risk: 'medium', reason: 'draft or hold PR should not be conflict-updated automatically' };
  }

  const files = uniqueStrings(pr.changedFiles);
  if (!hasCompletedVerification(pr.body ?? '')) {
    return { action: 'needs-verification', risk: 'medium', reason: 'conflicting PR lacks completed verification evidence' };
  }
  if (isScopeBroad(files)) {
    return {
      action: 'needs-decomposition',
      risk: 'high',
      reason: `conflict spans broad scope (${files.length} files) and should be split or rebuilt from main`,
    };
  }
  if (pr.reviewDecision === 'APPROVED') {
    return { action: 'attempt-update-branch', risk: 'medium', reason: 'approved conflicting PR has narrow verified scope' };
  }
  return { action: 'none', risk: 'medium', reason: 'conflicting PR is waiting for review approval before branch update' };
}

function pickReviewAssignment(pr: OpenPullRequestSummary): {
  reviewers: [PrReviewer, ...PrReviewer[]];
  framework: PrReviewFramework;
} {
  const text = `${pr.title}\n${pr.body ?? ''}`.toLowerCase();
  if (requiresHumanPrReview(text)) {
    return { reviewers: ['akari', 'alex'], framework: 'human-escalation' };
  }
  if (/(governance|hook|deploy|scheduler|arbiter|architecture|lifecycle)/.test(text)) {
    return { reviewers: ['akari', 'codex', 'claude-code'], framework: 'internal-governance' };
  }
  if (/(ui|dashboard|style|persona|aesthetic|akari|tanren)/.test(text)) {
    return { reviewers: ['akari'], framework: 'tanren-review' };
  }
  if (/(src\/|typescript|code|bug|fix|test|runtime|loop)/.test(text)) {
    return { reviewers: ['codex', 'claude-code'], framework: 'code-review' };
  }
  return { reviewers: ['claude-code'], framework: 'standard-peer' };
}

export function requiresHumanPrReview(text: string): boolean {
  return /(human[- ]?gate|requires?\s+alex|alex[- ]?review|credential|secret|billing|destructive|delete data|identity core|persona core)/i
    .test(text);
}

function escapeHandoffTableText(text: string): string {
  return text.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
}

function riskClass(pr: OpenPullRequestSummary): string {
  const text = `${pr.title}\n${pr.body ?? ''}`.toLowerCase();
  if (/(governance|hook|deploy|scheduler|arbiter|architecture|lifecycle)/.test(text)) return 'governance/high-risk';
  if (/(src\/|runtime|loop|scheduler|api|dispatcher)/.test(text)) return 'code';
  return 'standard';
}

function hasCompletedVerification(text: string): boolean {
  const section = extractMarkdownSection(text, /^##\s+Verification\b/im);
  if (!section) return false;
  return /(?:^|\n)\s*-\s*\[[xX]\]\s+/.test(section)
    || /\b(?:passed|passes|clean|success|ok)\b/i.test(section);
}

function extractMarkdownSection(text: string, heading: RegExp): string | null {
  const match = heading.exec(text);
  if (!match) return null;
  const start = match.index;
  const rest = text.slice(start);
  const next = rest.slice(match[0].length).search(/\n##\s+/);
  return next >= 0 ? rest.slice(0, match[0].length + next) : rest;
}

function isScopeBroad(files: string[]): boolean {
  if (files.length > 6) return true;
  const domains = new Set(files.map(fileDomain));
  if (domains.size > 3) return true;
  return files.some(file => /^memory\/(?:handoffs|topics|MEMORY\.md)/.test(file))
    && files.some(file => /^(src|tests|scripts|\.githooks|package\.json)/.test(file));
}

function fileDomain(file: string): string {
  if (file === 'package.json' || file === 'pnpm-lock.yaml') return 'package';
  if (file.startsWith('src/')) return `src/${file.split('/')[1] ?? ''}`;
  if (file.startsWith('tests/')) return 'tests';
  if (file.startsWith('memory/')) return 'memory';
  if (file.startsWith('scripts/')) return 'scripts';
  if (file.startsWith('.githooks/')) return 'hooks';
  return file.split('/')[0] ?? file;
}

function formatRefs(refs: number[]): string {
  return refs.length > 0 ? refs.map(ref => `#${ref}`).join(', ') : '(none)';
}

function uniqueNumbers(values: number[]): number[] {
  return [...new Set(values)].sort((a, b) => a - b);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
