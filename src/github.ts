/**
 * GitHub Mechanical Automation — fire-and-forget
 *
 * 四個自動化函數，每個 OODA cycle 結束後呼叫：
 * 1. autoCreateIssueFromProposal — approved proposal → GitHub issue
 * 2. autoCloseCompletedIssues — completed/implemented proposal → close issue
 * 3. autoMergeApprovedPR — approved + CI pass → auto merge
 * 4. autoTrackPrReviewNeeds — PR without reviewer signal → handoffs/active.md + inbox
 * 5. autoTrackPrReviewConsensus — review claims → handoff consensus status
 * 6. autoTrackMergedPrClosures — merged PR → close handoff loop
 * 7. autoTrackNewIssues — 新 issue → handoffs/active.md
 *
 * 全部 try-catch 靜默失敗，不影響 OODA cycle。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getMemoryRootDir, resolveMemoryPath } from './memory-paths.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { slog } from './utils.js';
import { writeInboxItem } from './inbox.js';
import {
  closeMergedPrHandoffs,
  decidePrReviewAssignment,
  decidePrConflictAction,
  type MergedPullRequestSummary,
  type OpenPullRequestSummary,
} from './pr-lifecycle-governance.js';
import {
  appendMissingInternalPrReviewClaims,
  evaluatePrReviewConsensus,
  parsePrReviewHandoffs,
  readPrReviewClaimsSync,
  reconcilePrReviewHandoffs,
  runPrReviewConsensus,
} from './pr-review-runner.js';

const execFileAsync = promisify(execFile);

async function gh(args: string[], timeout = 15000): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync('gh', args, {
    cwd: process.cwd(),
    encoding: 'utf-8',
    timeout,
    env: ghEnv(),
  });
  return {
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function ghEnv(): NodeJS.ProcessEnv {
  const token = process.env.KURO_GITHUB_TOKEN
    || process.env.KURO_GITHUB
    || readDotEnvValue('KURO_GITHUB_TOKEN')
    || readDotEnvValue('KURO_GITHUB');
  return {
    ...process.env,
    ...(token ? { GH_TOKEN: token, GITHUB_TOKEN: token } : {}),
  };
}

function readDotEnvValue(key: string): string | undefined {
  try {
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return undefined;
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || match[1] !== key) continue;
      return unquoteEnvValue(match[2]);
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function unquoteEnvValue(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Check if gh CLI is available and authenticated */
async function ghAvailable(): Promise<boolean> {
  try {
    await gh(['auth', 'status'], 5000);
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// 1. Approved proposal → GitHub issue
// =============================================================================

export async function autoCreateIssueFromProposal(): Promise<void> {
  const proposalsDir = resolveMemoryPath('proposals');
  if (!fs.existsSync(proposalsDir)) return;

  let files: string[];
  try {
    files = fs.readdirSync(proposalsDir).filter(f => f.endsWith('.md') && f !== 'README.md');
  } catch {
    return;
  }

  // Layer 3: Dedup guard — fetch all existing proposal issues once
  let existingByTitle: Map<string, number>;
  try {
    const { stdout } = await gh(['issue', 'list', '--label', 'proposal', '--state', 'all', '--json', 'number,title', '--limit', '200']);
    const issues: Array<{ number: number; title: string }> = JSON.parse(stdout);
    existingByTitle = new Map(issues.map(i => [i.title, i.number]));
  } catch {
    existingByTitle = new Map();
  }

  for (const file of files) {
    try {
      const filePath = path.join(proposalsDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');

      // 已有 GitHub-Issue → skip
      if (content.includes('GitHub-Issue:')) continue;

      // Layer 1: Strict status detection
      // Only match exact "Status: approved" at line start with ## or - prefix
      // Rejects: "approved → implemented", "approved (Part 1-3)", body text mentions
      const statusMatch = content.match(/^(##\s+|-\s+)Status:\s*approved\s*$/m);
      if (!statusMatch) continue;

      const titleMatch = content.match(/^# Proposal:\s*(.+)/m);
      const title = titleMatch?.[1]?.trim() ?? file.replace('.md', '');
      const issueTitle = `proposal: ${title}`;

      // Layer 3: If issue already exists on GitHub, just write back the ref
      const existingNum = existingByTitle.get(issueTitle);
      if (existingNum !== undefined) {
        writeBackIssueRef(filePath, content, statusMatch[0], existingNum);
        slog('github', `linked existing issue #${existingNum} to proposal: ${file}`);
        continue;
      }

      const tldrMatch = content.match(/## (?:TL;DR|What)\s*\n\n?([\s\S]*?)(?=\n## )/);
      const tldr = tldrMatch?.[1]?.trim() ?? '';

      const body = `Proposal: \`memory/proposals/${file}\`\n\n${tldr}`;

      const { stdout } = await gh(['issue', 'create', '--title', issueTitle, '--label', 'proposal', '--body', body]);

      // stdout 格式: https://github.com/owner/repo/issues/N
      const issueUrl = stdout.trim();
      const issueNum = issueUrl.match(/\/issues\/(\d+)/)?.[1];

      if (issueNum) {
        writeBackIssueRef(filePath, content, statusMatch[0], parseInt(issueNum, 10));
        slog('github', `created issue #${issueNum} from proposal: ${file}`);
      }
    } catch {
      // 單一檔案失敗不影響其他
    }
  }
}

/** Layer 2: Write GitHub-Issue ref back to proposal, handling both formats */
function writeBackIssueRef(filePath: string, content: string, statusLine: string, issueNum: number): void {
  // "## Status: approved" → add plain line after; "- Status: approved" → add list item after
  const ref = statusLine.startsWith('## ')
    ? `GitHub-Issue: #${issueNum}`
    : `- GitHub-Issue: #${issueNum}`;
  const updated = content.replace(statusLine, `${statusLine}\n${ref}`);
  if (updated !== content) {
    fs.writeFileSync(filePath, updated, 'utf-8');
  } else {
    slog('github', `WARN: write-back failed for ${path.basename(filePath)}`);
  }
}

// =============================================================================
// 2. Completed proposal → close GitHub issue
// =============================================================================

const TERMINAL_STATUSES = ['completed', 'implemented', 'superseded'];

export async function autoCloseCompletedIssues(): Promise<void> {
  const proposalsDir = resolveMemoryPath('proposals');
  if (!fs.existsSync(proposalsDir)) return;

  let files: string[];
  try {
    files = fs.readdirSync(proposalsDir).filter(f => f.endsWith('.md') && f !== 'README.md');
  } catch {
    return;
  }

  // Fetch open proposal issues once
  let openIssues: Map<number, string>;
  try {
    const { stdout } = await gh(['issue', 'list', '--label', 'proposal', '--state', 'open', '--json', 'number,title', '--limit', '200']);
    const issues: Array<{ number: number; title: string }> = JSON.parse(stdout);
    openIssues = new Map(issues.map(i => [i.number, i.title]));
  } catch {
    return; // Can't check without issue list
  }

  if (openIssues.size === 0) return;

  for (const file of files) {
    try {
      const filePath = path.join(proposalsDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');

      // Must have GitHub-Issue ref
      const issueMatch = content.match(/GitHub-Issue:\s*#(\d+)/);
      if (!issueMatch) continue;

      const issueNum = parseInt(issueMatch[1], 10);

      // Only process if this issue is actually open
      if (!openIssues.has(issueNum)) continue;

      // Check if proposal status is terminal
      const statusMatch = content.match(/^(?:##\s+|-\s+)Status:\s*(.+)$/m);
      if (!statusMatch) continue;

      const status = statusMatch[1].toLowerCase();
      if (!TERMINAL_STATUSES.some(s => status.includes(s))) continue;

      // Close the issue
      await gh(['issue', 'close', String(issueNum), '--comment', `Proposal status: ${statusMatch[1].trim()}`]);

      slog('github', `auto-closed issue #${issueNum} (${file})`);
    } catch {
      // 單一檔案失敗不影響其他
    }
  }
}

// =============================================================================
// 3. PR approved + CI pass → auto merge
// =============================================================================

interface PRInfo {
  number: number;
  title: string;
  reviewDecision: string;
  labels: Array<{ name: string }>;
  statusCheckRollup: Array<{ conclusion: string; status: string }>;
  isDraft?: boolean;
}

export async function autoMergeApprovedPR(): Promise<void> {
  let prs: PRInfo[];
  try {
    const { stdout } = await gh(['pr', 'list', '--state', 'open', '--json', 'number,title,reviewDecision,labels,statusCheckRollup,isDraft']);
    prs = JSON.parse(stdout);
  } catch {
    return;
  }

  for (const pr of prs) {
    try {
      // Skip PRs with 'hold' label
      if (pr.labels?.some(l => l.name === 'hold')) continue;

      // Must be approved
      if (pr.reviewDecision !== 'APPROVED') continue;

      if (pr.isDraft) continue;
      if (!statusChecksAcceptable(pr.statusCheckRollup, { allowMissingChecks: false })) continue;

      await gh(['pr', 'merge', String(pr.number), '--merge', '--delete-branch']);

      slog('github', `auto-merged PR #${pr.number}: ${pr.title}`);
    } catch {
      // 單一 PR 失敗不影響其他
    }
  }
}

// =============================================================================
// 4. PR review needs → handoffs/active.md + inbox
// =============================================================================

interface ReviewablePR {
  number: number;
  title: string;
  body?: string | null;
  isDraft?: boolean;
  reviewDecision?: string;
  labels?: Array<{ name: string }>;
  url?: string;
}

export async function autoTrackPrReviewNeeds(): Promise<void> {
  const activePath = resolveMemoryPath('handoffs', 'active.md');
  if (!fs.existsSync(activePath)) return;

  let prs: ReviewablePR[];
  try {
    const { stdout } = await gh(['pr', 'list', '--state', 'open', '--json', 'number,title,body,isDraft,reviewDecision,labels,url', '--limit', '50']);
    prs = JSON.parse(stdout);
  } catch {
    return;
  }

  let activeContent: string;
  try {
    activeContent = fs.readFileSync(activePath, 'utf-8');
  } catch {
    return;
  }

  const today = new Date().toISOString().slice(5, 10);
  const newRows: string[] = [];
  const assignments: Array<{ prNumber: number; reviewers: Array<'akari' | 'codex' | 'claude-code' | 'alex'> }> = [];
  let inboxCount = 0;

  for (const pr of prs) {
    const decision = decidePrReviewAssignment(toOpenPrSummary(pr));
    assignments.push({ prNumber: pr.number, reviewers: decision.reviewers });
    if (!decision.needsAssignment) continue;

    let addedReviewerRow = false;
    for (const reviewer of decision.reviewers) {
      const marker = `PR #${pr.number}`;
      const reviewerMarker = `| github | ${reviewer} | ${marker}`;
      if (!activeContent.includes(reviewerMarker) && !newRows.some(row => row.includes(reviewerMarker))) {
        newRows.push(`| github | ${reviewer} | ${marker} ${escapeTable(pr.title)} | needs-review | ${today} | - |`);
        addedReviewerRow = true;
      }
    }

    if (!addedReviewerRow) continue;

    const inboxId = writeInboxItem({
      source: 'github',
      from: 'system',
      content: `Review PR #${pr.number}: ${pr.title}`,
      meta: {
        prNumber: String(pr.number),
        reviewer: decision.reviewer,
        reviewers: decision.reviewers.join(','),
        framework: decision.framework,
        reason: decision.reason,
        ...(pr.url ? { url: pr.url } : {}),
      },
    });
    if (inboxId) inboxCount++;
  }

  let nextActiveContent = activeContent;
  if (newRows.length > 0) {
    nextActiveContent = activeContent.trimEnd() + '\n' + newRows.join('\n') + '\n';
  }
  nextActiveContent = reconcilePrReviewHandoffs(nextActiveContent, assignments);
  if (nextActiveContent !== activeContent) fs.writeFileSync(activePath, nextActiveContent, 'utf-8');
  if (newRows.length > 0 || inboxCount > 0) {
    slog('github', `tracked ${newRows.length} PR review handoff(s), ${inboxCount} inbox item(s)`);
  }
}

function toOpenPrSummary(pr: ReviewablePR): OpenPullRequestSummary {
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body,
    reviewDecision: pr.reviewDecision,
    reviewRequests: [],
    labels: pr.labels?.map(l => l.name),
    isDraft: pr.isDraft,
  };
}

function escapeTable(text: string): string {
  return text.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
}

// =============================================================================
// 5. Internal PR review claims
// =============================================================================

interface GhPrView {
  number: number;
  title: string;
  body?: string | null;
  headRefOid?: string;
  labels?: Array<{ name: string }>;
  files?: Array<{ path: string }>;
  isDraft?: boolean;
  reviewDecision?: string;
  mergeable?: string;
  url?: string;
}

export interface PrVerificationAutofixResult {
  changed: boolean;
  body: string;
  reason: string;
}

export function autofixPrVerificationSection(body?: string | null): PrVerificationAutofixResult {
  const text = body ?? '';
  if (hasVerificationSection(text)) {
    return { changed: false, body: text, reason: 'verification section already present' };
  }

  const section = findEvidenceSection(text);
  if (!section) {
    return { changed: false, body: text, reason: 'no test evidence section found' };
  }
  if (!sectionHasCompletedEvidence(section.content)) {
    return { changed: false, body: text, reason: 'test evidence section has no completed evidence' };
  }

  return {
    changed: true,
    body: text.slice(0, section.start) + '## Verification' + text.slice(section.headingEnd),
    reason: `renamed ${section.heading.trim()} to ## Verification`,
  };
}

export async function autoProduceInternalPrReviewClaims(): Promise<void> {
  const memoryDir = getMemoryRootDir();
  const activePath = path.join(memoryDir, 'handoffs', 'active.md');
  if (!fs.existsSync(activePath)) return;

  let handoffs = parsePrReviewHandoffs(fs.readFileSync(activePath, 'utf-8'));
  handoffs = handoffs.filter(h => h.reviewer !== 'alex' && ['needs-review', 'review-pending', 'changes-requested'].includes(h.status));
  if (handoffs.length === 0) return;

  const byPr = new Map<number, typeof handoffs>();
  for (const handoff of handoffs) {
    const list = byPr.get(handoff.prNumber) ?? [];
    list.push(handoff);
    byPr.set(handoff.prNumber, list);
  }

  const candidates = [];
  for (const [prNumber, rows] of byPr) {
    const pr = await viewPullRequest(prNumber);
    if (!pr || pr.isDraft) continue;
    const assignment = decidePrReviewAssignment(toOpenPrSummary(pr));
    for (const row of rows) {
      if (!assignment.reviewers.includes(row.reviewer)) continue;
      candidates.push({
        prNumber,
        title: pr.title,
        body: pr.body,
        headSha: pr.headRefOid,
        reviewer: row.reviewer,
        framework: assignment.framework,
        changedFiles: pr.files?.map(f => f.path).filter(Boolean) ?? [],
      });
    }
  }

  const result = appendMissingInternalPrReviewClaims(memoryDir, candidates);
  if (result.created.length > 0) {
    slog('github', `created ${result.created.length} internal PR review claim(s)`);
  }
}

export async function autoRepairPrVerificationEvidence(): Promise<void> {
  const memoryDir = getMemoryRootDir();
  const activePath = path.join(memoryDir, 'handoffs', 'active.md');
  if (!fs.existsSync(activePath)) return;

  const activeContent = fs.readFileSync(activePath, 'utf-8');
  const consensuses = evaluatePrReviewConsensus(parsePrReviewHandoffs(activeContent), readPrReviewClaimsSync(memoryDir))
    .filter(c => c.status === 'changes_requested')
    .filter(c => c.claims.some(claim => claim.summary === 'Code-affecting PR is missing verification evidence in the PR body.'));
  if (consensuses.length === 0) return;

  for (const consensus of consensuses) {
    try {
      const pr = await viewPullRequest(consensus.prNumber);
      if (!pr || pr.isDraft) continue;
      if (pr.labels?.some(label => label.name === 'hold')) continue;
      const fix = autofixPrVerificationSection(pr.body);
      if (!fix.changed) continue;
      await updatePullRequestBody(consensus.prNumber, fix.body);
      slog('github', `auto-repaired PR #${consensus.prNumber} verification evidence: ${fix.reason}`);
    } catch {
      // Single PR repair failure should not block the loop.
    }
  }
}

async function viewPullRequest(prNumber: number): Promise<GhPrView | null> {
  try {
    const { stdout } = await gh(['pr', 'view', String(prNumber), '--json', 'number,title,body,headRefOid,labels,files,isDraft,reviewDecision,mergeable,url']);
    return JSON.parse(stdout) as GhPrView;
  } catch {
    return null;
  }
}

async function updatePullRequestBody(prNumber: number, body: string): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-agent-pr-body-'));
  const file = path.join(dir, 'body.json');
  try {
    fs.writeFileSync(file, JSON.stringify({ body }), 'utf-8');
    await gh(['api', `repos/miles990/mini-agent/pulls/${prNumber}`, '-X', 'PATCH', '--input', file], 20000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// =============================================================================
// 6. PR review claims → handoff consensus status
// =============================================================================

export async function autoTrackPrReviewConsensus(): Promise<void> {
  const result = runPrReviewConsensus(getMemoryRootDir());
  if (result.updated) {
    const counts = result.consensuses.reduce<Record<string, number>>((acc, c) => {
      acc[c.status] = (acc[c.status] ?? 0) + 1;
      return acc;
    }, {});
    slog('github', `updated PR review consensus: ${Object.entries(counts).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  }
}

// =============================================================================
// 7. Internal consensus → GitHub approve / merge
// =============================================================================

export async function autoApplyInternalPrReviewConsensus(): Promise<void> {
  const memoryDir = getMemoryRootDir();
  const activePath = path.join(memoryDir, 'handoffs', 'active.md');
  if (!fs.existsSync(activePath)) return;

  const activeContent = fs.readFileSync(activePath, 'utf-8');
  const consensuses = evaluatePrReviewConsensus(parsePrReviewHandoffs(activeContent), readPrReviewClaimsSync(memoryDir))
    .filter(c => c.status === 'approved' && !c.requiredReviewers.includes('alex'));
  if (consensuses.length === 0) return;

  for (const consensus of consensuses) {
    try {
      await gh(['pr', 'review', String(consensus.prNumber), '--approve', '--body', internalApprovalBody(consensus.summary)]);
      slog('github', `submitted internal consensus approval for PR #${consensus.prNumber}`);
    } catch {
      // GitHub may reject self-approval. Internal consensus remains file truth.
    }
  }
}

export async function autoMergeInternallyApprovedPR(): Promise<void> {
  const memoryDir = getMemoryRootDir();
  const activePath = path.join(memoryDir, 'handoffs', 'active.md');
  if (!fs.existsSync(activePath)) return;

  const consensuses = evaluatePrReviewConsensus(
    parsePrReviewHandoffs(fs.readFileSync(activePath, 'utf-8')),
    readPrReviewClaimsSync(memoryDir),
  ).filter(c => c.status === 'approved' && !c.requiredReviewers.includes('alex'));
  if (consensuses.length === 0) return;
  const approved = new Set(consensuses.map(c => c.prNumber));

  let prs: PRInfo[];
  try {
    const { stdout } = await gh(['pr', 'list', '--state', 'open', '--json', 'number,title,reviewDecision,labels,statusCheckRollup,isDraft']);
    prs = JSON.parse(stdout);
  } catch {
    return;
  }

  for (const pr of prs) {
    try {
      if (!approved.has(pr.number)) continue;
      if (pr.isDraft || pr.labels?.some(l => l.name === 'hold')) continue;
      if (!statusChecksAcceptable(pr.statusCheckRollup, { allowMissingChecks: true })) continue;
      await gh(['pr', 'merge', String(pr.number), '--merge', '--delete-branch']);
      slog('github', `auto-merged internally approved PR #${pr.number}: ${pr.title}`);
    } catch {
      // Single PR failure should not block the loop.
    }
  }
}

// =============================================================================
// 7b. Conflicting PRs → update branch or explicit diagnostic
// =============================================================================

export async function autoHandleConflictingPRs(): Promise<void> {
  let prs: Array<{ number: number; mergeable?: string; labels?: Array<{ name: string }> }>;
  try {
    const { stdout } = await gh(['pr', 'list', '--state', 'open', '--json', 'number,mergeable,labels', '--limit', '50']);
    prs = JSON.parse(stdout);
  } catch {
    return;
  }

  for (const summary of prs.filter(pr => pr.mergeable === 'CONFLICTING')) {
    try {
      const pr = await viewPullRequest(summary.number);
      if (!pr) continue;
      const decision = decidePrConflictAction({
        number: pr.number,
        title: pr.title,
        body: pr.body,
        mergeable: pr.mergeable,
        reviewDecision: pr.reviewDecision,
        labels: pr.labels?.map(label => label.name),
        isDraft: pr.isDraft,
        changedFiles: pr.files?.map(file => file.path).filter(Boolean) ?? [],
      });

      if (decision.action === 'attempt-update-branch') {
        await gh(['pr', 'update-branch', String(pr.number)], 30000);
        slog('github', `requested conflict update-branch for PR #${pr.number}: ${decision.reason}`);
        continue;
      }

      if (decision.action === 'needs-decomposition' || decision.action === 'needs-verification') {
        await recordConflictDiagnostic(pr, decision);
      }
    } catch {
      // Single PR conflict handling failure should not block the loop.
    }
  }
}

function internalApprovalBody(summary: string): string {
  return [
    'Internal multi-brain review consensus approved this PR.',
    '',
    `Consensus: ${summary}`,
    '',
    'File-truth source: memory/index/pr-review-claims.jsonl',
  ].join('\n');
}

async function recordConflictDiagnostic(pr: GhPrView, decision: { action: string; reason: string; risk: string }): Promise<void> {
  const marker = `mini-agent:conflict-diagnostic:${pr.number}:${pr.headRefOid ?? 'unknown'}`;
  appendConflictHandoff(pr, decision);
  if (await prHasCommentMarker(pr.number, marker)) return;

  await addPrComment(pr.number, [
    `<!-- ${marker} -->`,
    `Conflict diagnostic: ${decision.action}`,
    '',
    `Reason: ${decision.reason}`,
    `Risk: ${decision.risk}`,
    '',
    'Autonomous action: not auto-merging this PR until the conflict is resolved.',
    'Next step: split/rebuild the PR from current main or add completed verification evidence, then the review loop will re-evaluate it.',
  ].join('\n'));
  slog('github', `recorded conflict diagnostic for PR #${pr.number}: ${decision.action}`);
}

async function prHasCommentMarker(prNumber: number, marker: string): Promise<boolean> {
  try {
    const { stdout } = await gh(['api', `repos/miles990/mini-agent/issues/${prNumber}/comments`, '--paginate']);
    const comments = JSON.parse(stdout) as Array<{ body?: string }>;
    return comments.some(comment => comment.body?.includes(marker));
  } catch {
    return false;
  }
}

async function addPrComment(prNumber: number, body: string): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-agent-pr-comment-'));
  const file = path.join(dir, 'comment.json');
  try {
    fs.writeFileSync(file, JSON.stringify({ body }), 'utf-8');
    await gh(['api', `repos/miles990/mini-agent/issues/${prNumber}/comments`, '-X', 'POST', '--input', file], 20000);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function appendConflictHandoff(pr: GhPrView, decision: { action: string; reason: string }): void {
  const activePath = resolveMemoryPath('handoffs', 'active.md');
  if (!fs.existsSync(activePath)) return;
  const content = fs.readFileSync(activePath, 'utf-8');
  const marker = `PR #${pr.number} conflict diagnostic`;
  if (content.includes(marker)) return;
  const today = new Date().toISOString().slice(5, 10);
  const row = `| github | kuro | ${marker}: ${escapeTable(pr.title)} (${decision.action}; ${escapeTable(decision.reason)}) | blocked | ${today} | - |`;
  fs.writeFileSync(activePath, content.trimEnd() + '\n' + row + '\n', 'utf-8');
}

function statusChecksAcceptable(
  checks: Array<{ conclusion: string; status: string }> = [],
  opts: { allowMissingChecks: boolean },
): boolean {
  if (checks.length === 0) return opts.allowMissingChecks;
  return checks.every(check => check.conclusion === 'SUCCESS');
}

// =============================================================================
// 8. Merged PR → close handoff loop
// =============================================================================

interface MergedPR {
  number: number;
  title: string;
  mergedAt?: string | null;
}

export async function autoTrackMergedPrClosures(): Promise<void> {
  const activePath = resolveMemoryPath('handoffs', 'active.md');
  if (!fs.existsSync(activePath)) return;

  let prs: MergedPR[];
  try {
    const { stdout } = await gh(['pr', 'list', '--state', 'merged', '--json', 'number,title,mergedAt', '--limit', '20']);
    prs = JSON.parse(stdout);
  } catch {
    return;
  }

  const recent = prs.filter(pr => isRecentlyMerged(pr.mergedAt));
  if (recent.length === 0) return;

  let activeContent: string;
  try {
    activeContent = fs.readFileSync(activePath, 'utf-8');
  } catch {
    return;
  }

  const today = new Date().toISOString().slice(5, 10);
  const result = closeMergedPrHandoffs(activeContent, recent.map(toMergedPrSummary), today);
  if (result.content !== activeContent) {
    fs.writeFileSync(activePath, result.content, 'utf-8');
    slog('github', `closed ${result.updated} merged PR handoff(s), appended ${result.appended} closure row(s)`);
  }
}

function toMergedPrSummary(pr: MergedPR): MergedPullRequestSummary {
  return {
    number: pr.number,
    title: pr.title,
    mergedAt: pr.mergedAt,
  };
}

function isRecentlyMerged(mergedAt?: string | null): boolean {
  if (!mergedAt) return false;
  const mergedTime = Date.parse(mergedAt);
  if (!Number.isFinite(mergedTime)) return false;
  return Date.now() - mergedTime <= 7 * 24 * 60 * 60 * 1000;
}

// =============================================================================
// 7. 新 issue → handoffs/active.md
// =============================================================================

export async function autoTrackNewIssues(): Promise<void> {
  const activePath = resolveMemoryPath('handoffs', 'active.md');
  if (!fs.existsSync(activePath)) return;

  let issues: Array<{ number: number; title: string; createdAt: string; labels?: Array<{ name: string }> }>;
  try {
    const { stdout } = await gh(['issue', 'list', '--state', 'open', '--json', 'number,title,createdAt,labels', '--limit', '20']);
    issues = JSON.parse(stdout);
  } catch {
    return;
  }

  if (issues.length === 0) return;

  let activeContent: string;
  try {
    activeContent = fs.readFileSync(activePath, 'utf-8');
  } catch {
    return;
  }

  // 找出 active.md 中已追蹤的 issue numbers
  const trackedNumbers = new Set<number>();
  const issueRefPattern = /#(\d+)/g;
  let match;
  while ((match = issueRefPattern.exec(activeContent)) !== null) {
    trackedNumbers.add(parseInt(match[1], 10));
  }

  // 新 issue = 不在 active.md 中的
  const newIssues = issues.filter(i => !trackedNumbers.has(i.number));
  if (newIssues.length === 0) return;

  // 加入新行到 active.md 表格
  const today = new Date().toISOString().slice(5, 10).replace('-', '-');  // MM-DD
  const newRows = newIssues.map(i =>
    `| github | kuro | #${i.number} ${i.title} | needs-triage | ${today} | — |`,
  ).join('\n');

  const updated = activeContent.trimEnd() + '\n' + newRows + '\n';
  fs.writeFileSync(activePath, updated, 'utf-8');

  // Dual-write to unified inbox
  for (const i of newIssues) {
    writeInboxItem({
      source: 'github',
      from: 'system',
      content: `#${i.number} ${i.title}`,
      meta: {
        issueNumber: String(i.number),
        ...(i.labels?.length ? { labels: i.labels.map(l => l.name).join(',') } : {}),
      },
    });
  }

  slog('github', `tracked ${newIssues.length} new issue(s) in active.md`);
}

// =============================================================================
// 統一入口 — fire-and-forget
// =============================================================================

export async function githubAutoActions(): Promise<void> {
  if (!await ghAvailable()) return;

  await autoCreateIssueFromProposal().catch(() => {});
  await autoCloseCompletedIssues().catch(() => {});
  await autoTrackPrReviewNeeds().catch(() => {});
  await autoProduceInternalPrReviewClaims().catch(() => {});
  await autoTrackPrReviewConsensus().catch(() => {});
  await autoRepairPrVerificationEvidence().catch(() => {});
  await autoApplyInternalPrReviewConsensus().catch(() => {});
  await autoMergeApprovedPR().catch(() => {});
  await autoMergeInternallyApprovedPR().catch(() => {});
  await autoHandleConflictingPRs().catch(() => {});
  await autoTrackMergedPrClosures().catch(() => {});
  await autoTrackNewIssues().catch(() => {});
}

function hasVerificationSection(body: string): boolean {
  return /^##\s+Verification\b/im.test(body);
}

function findEvidenceSection(body: string): { start: number; headingEnd: number; heading: string; content: string } | null {
  const headingRe = /^##\s+(Test plan|Tests|Test Plan|Testing)\b.*$/gim;
  let match: RegExpExecArray | null;
  while ((match = headingRe.exec(body)) !== null) {
    const start = match.index;
    const heading = match[0];
    const headingEnd = start + heading.length;
    const contentStart = headingEnd;
    const nextHeading = body.slice(contentStart).search(/\n##\s+/);
    const end = nextHeading >= 0 ? contentStart + nextHeading : body.length;
    return { start, headingEnd, heading, content: body.slice(contentStart, end) };
  }
  return null;
}

function sectionHasCompletedEvidence(section: string): boolean {
  const hasCompletedMarker = /(?:^|\n)\s*-\s*\[[xX]\]\s+/.test(section)
    || /(?:^|\n)\s*(?:`{3}|[$>])/.test(section);
  const hasVerificationCommand = /\b(?:pnpm|npm|npx|vitest|tsc|typecheck|build|test|smoke|grep)\b/i.test(section);
  const hasPassSignal = /\b(?:pass(?:ed|es)?|clean|0 lines|verified|ok|success)\b/i.test(section);
  return hasCompletedMarker && hasVerificationCommand && hasPassSignal;
}
