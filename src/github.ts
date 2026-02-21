/**
 * GitHub Mechanical Automation — fire-and-forget
 *
 * 三個自動化函數，每個 OODA cycle 結束後呼叫：
 * 1. autoCreateIssueFromProposal — approved proposal → GitHub issue
 * 2. autoMergeApprovedPR — approved + CI pass → auto merge
 * 3. autoTrackNewIssues — 新 issue → handoffs/active.md
 *
 * 全部 try-catch 靜默失敗，不影響 OODA cycle。
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { slog } from './utils.js';

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

  for (const file of files) {
    try {
      const filePath = path.join(proposalsDir, file);
      const content = fs.readFileSync(filePath, 'utf-8');

      // 只處理 Status: approved 且沒有 GitHub-Issue 的
      if (!content.includes('Status: approved')) continue;
      if (content.includes('GitHub-Issue:')) continue;

      const titleMatch = content.match(/^# Proposal:\s*(.+)/m);
      const title = titleMatch?.[1]?.trim() ?? file.replace('.md', '');

      const tldrMatch = content.match(/## (?:TL;DR|What)\s*\n\n?([\s\S]*?)(?=\n## )/);
      const tldr = tldrMatch?.[1]?.trim() ?? '';

      const body = `Proposal: \`memory/proposals/${file}\`\n\n${tldr}`;

      const { stdout } = await execFileAsync(
        'gh', ['issue', 'create', '--title', `proposal: ${title}`, '--label', 'proposal', '--body', body],
        { cwd: process.cwd(), encoding: 'utf-8', timeout: 15000 },
      );

      // stdout 格式: https://github.com/owner/repo/issues/N
      const issueUrl = stdout.trim();
      const issueNum = issueUrl.match(/\/issues\/(\d+)/)?.[1];

      if (issueNum) {
        // 寫回 GitHub-Issue 到 proposal Meta section
        const updated = content.replace(
          /^(- Status: approved)/m,
          `$1\n- GitHub-Issue: #${issueNum}`,
        );
        fs.writeFileSync(filePath, updated, 'utf-8');
        slog('github', `created issue #${issueNum} from proposal: ${file}`);
      }
    } catch {
      // 單一檔案失敗不影響其他
    }
  }
}

// =============================================================================
// 2. PR approved + CI pass → auto merge
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
// 3. 新 issue → handoffs/active.md
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
  slog('github', `tracked ${newIssues.length} new issue(s) in active.md`);
}

// =============================================================================
// 統一入口 — fire-and-forget
// =============================================================================

export async function githubAutoActions(): Promise<void> {
  if (!await ghAvailable()) return;

  await autoCreateIssueFromProposal().catch(() => {});
  await autoMergeApprovedPR().catch(() => {});
  await autoTrackNewIssues().catch(() => {});
}
