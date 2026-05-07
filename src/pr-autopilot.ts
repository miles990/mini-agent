import fs from 'node:fs';
import path from 'node:path';
import { decidePrReviewAssignment, type OpenPullRequestSummary } from './pr-lifecycle-governance.js';

export const OPEN_PRS_SNAPSHOT_FILE = 'open-prs.json';
export const DEFAULT_DRAFT_TTL_HOURS = 2;
export const DEFAULT_SNAPSHOT_TTL_HOURS = 2;

export interface OpenPrSnapshotEntry extends OpenPullRequestSummary {
  url?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  headRefName?: string | null;
}

export interface OpenPrSnapshot {
  generatedAt: string;
  prs: OpenPrSnapshotEntry[];
}

export interface PrClosureGaps {
  snapshotMissing: boolean;
  snapshotStale: boolean;
  snapshotGeneratedAt?: string;
  readyUntracked: OpenPrSnapshotEntry[];
  staleDrafts: OpenPrSnapshotEntry[];
  approvedBlocked: OpenPrSnapshotEntry[];
}

export interface IssueStateSummary {
  number: number;
  state: string;
  closedAt?: string | null;
}

const CLOSING_REF_RE = /(?:^|[\s(])(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)\b/gi;

export function getOpenPrSnapshotPath(memoryDir: string): string {
  return path.join(memoryDir, 'state', OPEN_PRS_SNAPSHOT_FILE);
}

export function writeOpenPrSnapshot(memoryDir: string, prs: OpenPrSnapshotEntry[], now = new Date()): OpenPrSnapshot {
  const snapshot = {
    generatedAt: now.toISOString(),
    prs: prs.map(normalizePrSnapshotEntry),
  };
  const snapshotPath = getOpenPrSnapshotPath(memoryDir);
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
  return snapshot;
}

export function readOpenPrSnapshot(memoryDir: string): OpenPrSnapshot | null {
  const snapshotPath = getOpenPrSnapshotPath(memoryDir);
  if (!fs.existsSync(snapshotPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as OpenPrSnapshot;
    if (!Array.isArray(parsed.prs)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function evaluatePrClosureGaps(
  memoryDir: string,
  activeContent: string,
  now = new Date(),
  options: { draftTtlHours?: number; snapshotTtlHours?: number } = {},
): PrClosureGaps {
  const snapshot = readOpenPrSnapshot(memoryDir);
  if (!snapshot) {
    return {
      snapshotMissing: true,
      snapshotStale: false,
      readyUntracked: [],
      staleDrafts: [],
      approvedBlocked: [],
    };
  }

  const snapshotTtlHours = options.snapshotTtlHours ?? DEFAULT_SNAPSHOT_TTL_HOURS;
  const generatedAtMs = Date.parse(snapshot.generatedAt);
  const snapshotStale = !Number.isFinite(generatedAtMs)
    || (now.getTime() - generatedAtMs) >= snapshotTtlHours * 60 * 60 * 1000;

  const gaps = findUntrackedPrs(snapshot.prs, activeContent, now, options);
  return {
    snapshotMissing: false,
    snapshotStale,
    snapshotGeneratedAt: snapshot.generatedAt,
    ...gaps,
    approvedBlocked: findApprovedBlockedPrs(snapshot.prs),
  };
}

export function findUntrackedPrs(
  prs: OpenPrSnapshotEntry[],
  activeContent: string,
  now = new Date(),
  options: { draftTtlHours?: number } = {},
): Pick<PrClosureGaps, 'readyUntracked' | 'staleDrafts'> {
  const tracked = parseTrackedPrNumbers(activeContent);
  const draftTtlHours = options.draftTtlHours ?? getDraftTtlHours();
  const readyUntracked: OpenPrSnapshotEntry[] = [];
  const staleDrafts: OpenPrSnapshotEntry[] = [];

  for (const pr of prs) {
    if (tracked.has(pr.number)) continue;
    const labels = new Set((pr.labels ?? []).map(label => label.toLowerCase()));
    if (labels.has('hold')) continue;

    const decision = decidePrReviewAssignment(pr);
    if (decision.needsAssignment) {
      readyUntracked.push(pr);
      continue;
    }

    if (pr.isDraft && ageHours(pr.createdAt, now) >= draftTtlHours) {
      staleDrafts.push(pr);
    }
  }

  return { readyUntracked, staleDrafts };
}

export function findApprovedBlockedPrs(prs: OpenPrSnapshotEntry[]): OpenPrSnapshotEntry[] {
  return prs.filter(pr => {
    if (pr.isDraft) return false;
    if (pr.reviewDecision !== 'APPROVED') return false;
    const labels = new Set((pr.labels ?? []).map(label => label.toLowerCase()));
    if (labels.has('hold')) return false;
    return isBlockedMergeState(pr.mergeStateStatus) || isBlockedMergeable(pr.mergeable);
  });
}

export function appendStaleDraftPrHandoffs(
  activeContent: string,
  prs: OpenPrSnapshotEntry[],
  today: string,
): { content: string; appended: number } {
  let content = activeContent.trimEnd();
  let appended = 0;
  const existing = parseTrackedPrNumbers(activeContent);

  for (const pr of prs) {
    if (existing.has(pr.number) || content.includes(`PR #${pr.number}`)) continue;
    content += `\n| github | kuro | PR #${pr.number} draft triage: ${escapeTable(pr.title)} | needs-triage | ${today} | - |`;
    appended++;
  }

  return {
    content: appended > 0 ? content + '\n' : activeContent,
    appended,
  };
}

export function parseTrackedPrNumbers(activeContent: string): Set<number> {
  const tracked = new Set<number>();
  for (const line of activeContent.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const match = line.match(/\bPR #(\d+)\b/);
    if (match) tracked.add(Number(match[1]));
  }
  return tracked;
}

export function extractClosingIssueRefs(text: string): number[] {
  const refs = new Set<number>();
  let match: RegExpExecArray | null;
  while ((match = CLOSING_REF_RE.exec(text)) !== null) refs.add(Number(match[1]));
  return [...refs].sort((a, b) => a - b);
}

export function shouldAutoCloseSupersededPr(
  pr: Pick<OpenPrSnapshotEntry, 'createdAt' | 'isDraft' | 'labels'>,
  closingRefs: number[],
  issues: IssueStateSummary[],
): boolean {
  if (pr.isDraft) return false;
  const labels = new Set((pr.labels ?? []).map(label => label.toLowerCase()));
  if (labels.has('hold')) return false;
  if (closingRefs.length === 0 || issues.length !== closingRefs.length) return false;

  const prCreatedAt = Date.parse(pr.createdAt ?? '');
  if (!Number.isFinite(prCreatedAt)) return false;

  return issues.every(issue => {
    if (issue.state.toUpperCase() !== 'CLOSED') return false;
    const closedAt = Date.parse(issue.closedAt ?? '');
    return Number.isFinite(closedAt) && closedAt >= prCreatedAt;
  });
}

export function getDraftTtlHours(): number {
  const raw = process.env.MINI_AGENT_PR_DRAFT_TTL_HOURS;
  const parsed = raw ? Number(raw) : DEFAULT_DRAFT_TTL_HOURS;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DRAFT_TTL_HOURS;
}

function normalizePrSnapshotEntry(pr: OpenPrSnapshotEntry): OpenPrSnapshotEntry {
  return {
    number: pr.number,
    title: pr.title,
    body: pr.body ?? null,
    authorLogin: pr.authorLogin ?? null,
    labels: pr.labels ?? [],
    isDraft: Boolean(pr.isDraft),
    reviewDecision: pr.reviewDecision ?? null,
    reviewRequests: Array.isArray(pr.reviewRequests) ? pr.reviewRequests : [],
    url: pr.url,
    createdAt: pr.createdAt ?? null,
    updatedAt: pr.updatedAt ?? null,
    headRefName: pr.headRefName ?? null,
    mergeStateStatus: pr.mergeStateStatus ?? null,
    mergeable: pr.mergeable ?? null,
  };
}

function isBlockedMergeState(value: string | null | undefined): boolean {
  return ['DIRTY', 'BLOCKED', 'UNKNOWN'].includes(String(value ?? '').toUpperCase());
}

function isBlockedMergeable(value: string | null | undefined): boolean {
  return ['CONFLICTING', 'UNKNOWN'].includes(String(value ?? '').toUpperCase());
}

function ageHours(iso: string | null | undefined, now: Date): number {
  const then = Date.parse(iso ?? '');
  if (!Number.isFinite(then)) return 0;
  return (now.getTime() - then) / (60 * 60 * 1000);
}

function escapeTable(text: string): string {
  return text.replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
}
