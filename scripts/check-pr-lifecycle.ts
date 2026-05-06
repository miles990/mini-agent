#!/usr/bin/env tsx
import { execFileSync } from 'node:child_process';
import {
  analyzeBranchLifecycle,
  parseGitLogRecords,
  type PullRequestSummary,
} from '../src/pr-lifecycle-governance.js';

const baseBranch = process.env.MINI_AGENT_BASE_BRANCH ?? 'main';
const allowContamination = process.env.MINI_AGENT_ALLOW_SCOPE_CONTAMINATION === '1';
const json = process.argv.includes('--json');

git(['fetch', '--quiet', 'origin', baseBranch]);
const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim() || null;
const dirty = git(['status', '--porcelain']).trim().length > 0;
const commitsAhead = parseGitLogRecords(git(['log', '--format=%H%x1f%s%x1f%b%x1e', `origin/${baseBranch}..HEAD`]));
const behindBase = countBehindBase(baseBranch);
const pullRequest = readCurrentPr();
const analysis = analyzeBranchLifecycle({
  branch,
  baseBranch,
  dirty,
  commitsAhead,
  behindBase,
  pullRequest,
});

if (json) {
  process.stdout.write(JSON.stringify(analysis, null, 2) + '\n');
} else {
  process.stderr.write(formatHuman(analysis));
}

if (analysis.shouldBlockPush && !allowContamination) {
  process.stderr.write('\n[pr-lifecycle] push blocked. Set MINI_AGENT_ALLOW_SCOPE_CONTAMINATION=1 only for an intentional override.\n');
  process.exit(1);
}

function readCurrentPr(): PullRequestSummary | null {
  try {
    const out = execFileSync('gh', [
      'pr',
      'view',
      '--json',
      'number,title,body,reviewDecision,reviewRequests',
    ], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 8000,
    });
    const parsed = JSON.parse(out) as PullRequestSummary;
    return typeof parsed.number === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

function git(args: string[]): string {
  try {
    return execFileSync('git', args, {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 8000,
    });
  } catch {
    return '';
  }
}

function countBehindBase(base: string): number {
  const raw = git(['rev-list', '--left-right', '--count', `HEAD...origin/${base}`]).trim();
  const parts = raw.split(/\s+/);
  return Number(parts[1] ?? 0) || 0;
}

function formatHuman(analysis: ReturnType<typeof analyzeBranchLifecycle>): string {
  const lines = [
    `[pr-lifecycle] status=${analysis.status} branch=${analysis.branch ?? 'unknown'} base=${analysis.baseBranch} ahead=${analysis.ahead} behind=${analysis.behindBase} dirty=${analysis.dirty}`,
  ];
  if (analysis.pullRequest) {
    lines.push(`[pr-lifecycle] pr=#${analysis.pullRequest.number} ${analysis.pullRequest.title}`);
    lines.push(`[pr-lifecycle] allowed=${analysis.allowedIssueRefs.map(r => `#${r}`).join(', ') || '(none)'} refs=${analysis.issueRefs.map(r => `#${r}`).join(', ') || '(none)'}`);
    if (analysis.unscopedCommitSubjects.length > 0) {
      lines.push(`[pr-lifecycle] unscoped=${analysis.unscopedCommitSubjects.map(subject => JSON.stringify(subject)).join(', ')}`);
    }
  }
  for (const guidance of analysis.guidance) lines.push(`[pr-lifecycle] ${guidance}`);
  return lines.join('\n') + '\n';
}
