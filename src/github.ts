/**
 * GitHub Mechanical Automation — fire-and-forget
 *
 * 四個自動化函數，每個 OODA cycle 結束後呼叫：
 * 1. autoCreateIssueFromProposal — approved proposal → GitHub issue
 * 2. autoCloseCompletedIssues — completed/implemented proposal → close issue
 * 3. autoMergeApprovedPR — approved + CI pass → auto merge
 * 4. autoTrackNewIssues — 新 issue → handoffs/active.md
 *
 * 全部 try-catch 靜默失敗，不影響 OODA cycle。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { slog } from './utils.js';
import { writeInboxItem } from './inbox.js';

const execFileAsync = promisify(execFile);

/** Check if gh CLI is available and authenticated */
async function ghAvailable(): Promise<boolean> {
  try {
    await execFileAsync('gh', ['auth', 'status'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// 1. Approved proposal → GitHub issue
// =============================================================================

export async function autoCreateIssueFromProposal(): Promise<void> {
  const proposalsDir = path.join(process.cwd(), 'memory', 'proposals');
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
    const { stdout } = await execFileAsync(
      'gh', ['issue', 'list', '--label', 'proposal', '--state', 'all', '--json', 'number,title', '--limit', '200'],
      { cwd: process.cwd(), encoding: 'utf-8', timeout: 15000 },
    );
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

      const { stdout } = await execFileAsync(
        'gh', ['issue', 'create', '--title', issueTitle, '--label', 'proposal', '--body', body],
        { cwd: process.cwd(), encoding: 'utf-8', timeout: 15000 },
      );

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
  const proposalsDir = path.join(process.cwd(), 'memory', 'proposals');
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
    const { stdout } = await execFileAsync(
      'gh', ['issue', 'list', '--label', 'proposal', '--state', 'open', '--json', 'number,title', '--limit', '200'],
      { cwd: process.cwd(), encoding: 'utf-8', timeout: 15000 },
    );
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
      await execFileAsync(
        'gh', ['issue', 'close', String(issueNum), '--comment', `Proposal status: ${statusMatch[1].trim()}`],
        { cwd: process.cwd(), encoding: 'utf-8', timeout: 15000 },
      );

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
}

export async function autoMergeApprovedPR(): Promise<void> {
  let prs: PRInfo[];
  try {
    const { stdout } = await execFileAsync(
      'gh', ['pr', 'list', '--state', 'open', '--json', 'number,title,reviewDecision,labels,statusCheckRollup'],
      { cwd: process.cwd(), encoding: 'utf-8', timeout: 15000 },
    );
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

      // All CI checks must pass
      if (pr.statusCheckRollup.length === 0) continue;
      const allPass = pr.statusCheckRollup.every(c => c.conclusion === 'SUCCESS');
      if (!allPass) continue;

      await execFileAsync(
        'gh', ['pr', 'merge', String(pr.number), '--merge', '--delete-branch'],
        { cwd: process.cwd(), encoding: 'utf-8', timeout: 15000 },
      );

      slog('github', `auto-merged PR #${pr.number}: ${pr.title}`);
    } catch {
      // 單一 PR 失敗不影響其他
    }
  }
}

// =============================================================================
// 4. 新 issue → handoffs/active.md
// =============================================================================

export async function autoTrackNewIssues(): Promise<void> {
  const activePath = path.join(process.cwd(), 'memory', 'handoffs', 'active.md');
  if (!fs.existsSync(activePath)) return;

  let issues: Array<{ number: number; title: string; createdAt: string }>;
  try {
    const { stdout } = await execFileAsync(
      'gh', ['issue', 'list', '--state', 'open', '--json', 'number,title,createdAt', '--limit', '20'],
      { cwd: process.cwd(), encoding: 'utf-8', timeout: 15000 },
    );
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
      meta: { issueNumber: String(i.number) },
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
  await autoMergeApprovedPR().catch(() => {});
  await autoTrackNewIssues().catch(() => {});
}
