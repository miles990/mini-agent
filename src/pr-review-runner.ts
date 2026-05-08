import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { requiresHumanPrReview, type PrReviewFramework, type PrReviewer } from './pr-lifecycle-governance.js';

export type PrReviewVerdict = 'approve' | 'request_changes' | 'comment';
export type PrReviewConsensusStatus = 'pending' | 'approved' | 'changes_requested' | 'commented' | 'disputed';

export interface PrReviewClaimInput {
  prNumber: number;
  reviewer: PrReviewer;
  framework: PrReviewFramework;
  verdict: PrReviewVerdict;
  risk: 'low' | 'medium' | 'high';
  summary: string;
  evidence: string[];
  reviewInputHash?: string;
  headSha?: string;
}

export interface PrReviewClaim extends PrReviewClaimInput {
  id: string;
  createdAt: string;
}

export interface PrReviewHandoff {
  prNumber: number;
  reviewer: PrReviewer;
  title: string;
  status: string;
  line: string;
}

export interface PrReviewConsensus {
  prNumber: number;
  status: PrReviewConsensusStatus;
  requiredReviewers: PrReviewer[];
  receivedReviewers: PrReviewer[];
  missingReviewers: PrReviewer[];
  claims: PrReviewClaim[];
  summary: string;
}

export interface InternalPrReviewCandidate {
  prNumber: number;
  title: string;
  body?: string | null;
  headSha?: string | null;
  reviewer: PrReviewer;
  framework: PrReviewFramework;
  changedFiles: string[];
}

export interface InternalPrReviewClaimResult {
  created: PrReviewClaim[];
  skipped: Array<{ prNumber: number; reviewer: PrReviewer; reason: string }>;
}

const PR_REVIEW_CLAIMS_FILE = 'pr-review-claims.jsonl';
const PR_HANDOFF_RE = /^\|\s*github\s*\|\s*(\S+)\s*\|\s*PR #(\d+)\s+(.+?)\s*\|\s*([^|]+?)\s*\|/;
const REVIEW_STATUSES = ['needs-review', 'review-pending', 'review-approved', 'changes-requested'];
const REVIEW_INPUT_POLICY_VERSION = 2;

export function getPrReviewClaimsPath(memoryDir: string): string {
  return path.join(memoryDir, 'index', PR_REVIEW_CLAIMS_FILE);
}

export function createPrReviewClaim(input: PrReviewClaimInput, now = new Date()): PrReviewClaim {
  if (!Number.isInteger(input.prNumber) || input.prNumber <= 0) throw new Error('prNumber must be positive');
  if (!input.summary.trim()) throw new Error('summary is required');
  return {
    ...input,
    id: randomUUID(),
    createdAt: now.toISOString(),
  };
}

export function computePrReviewInputHash(candidate: InternalPrReviewCandidate): string {
  const changedFiles = uniqueStrings(candidate.changedFiles);
  return createHash('sha256')
    .update(JSON.stringify({
      policyVersion: REVIEW_INPUT_POLICY_VERSION,
      prNumber: candidate.prNumber,
      title: candidate.title,
      body: candidate.body ?? '',
      headSha: candidate.headSha ?? '',
      changedFiles,
    }))
    .digest('hex')
    .slice(0, 16);
}

export function appendPrReviewClaim(memoryDir: string, claim: PrReviewClaim): PrReviewClaim {
  const filePath = ensurePrReviewClaimsFile(memoryDir);
  appendFileSync(filePath, JSON.stringify(claimToRecord(claim)) + '\n', 'utf-8');
  return claim;
}

export function readPrReviewClaimsSync(memoryDir: string, prNumber?: number): PrReviewClaim[] {
  const filePath = ensurePrReviewClaimsFile(memoryDir);
  const claims: PrReviewClaim[] = [];
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    const claim = parseClaim(line);
    if (!claim) continue;
    if (prNumber !== undefined && claim.prNumber !== prNumber) continue;
    claims.push(claim);
  }
  return claims.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function parsePrReviewHandoffs(activeContent: string): PrReviewHandoff[] {
  const handoffs: PrReviewHandoff[] = [];
  for (const line of activeContent.split('\n')) {
    const match = line.match(PR_HANDOFF_RE);
    if (!match) continue;
    const reviewer = normalizeReviewer(match[1]);
    if (!reviewer) continue;
    const status = match[4].trim();
    if (!REVIEW_STATUSES.includes(status)) continue;
    handoffs.push({
      prNumber: Number(match[2]),
      reviewer,
      title: match[3].trim(),
      status,
      line,
    });
  }
  return handoffs;
}

export function evaluatePrReviewConsensus(
  handoffs: PrReviewHandoff[],
  claims: PrReviewClaim[],
): PrReviewConsensus[] {
  const byPr = new Map<number, PrReviewHandoff[]>();
  for (const handoff of handoffs) {
    const list = byPr.get(handoff.prNumber) ?? [];
    list.push(handoff);
    byPr.set(handoff.prNumber, list);
  }

  return [...byPr.entries()]
    .sort(([a], [b]) => a - b)
    .map(([prNumber, prHandoffs]) => {
      const requiredReviewers = uniqueReviewers(prHandoffs.map(h => h.reviewer));
      const latestClaims = latestClaimPerReviewer(claims.filter(c => c.prNumber === prNumber));
      const receivedReviewers = uniqueReviewers(latestClaims.map(c => c.reviewer));
      const missingReviewers = requiredReviewers.filter(reviewer => !receivedReviewers.includes(reviewer));
      const status = consensusStatus(requiredReviewers, latestClaims, missingReviewers);
      return {
        prNumber,
        status,
        requiredReviewers,
        receivedReviewers,
        missingReviewers,
        claims: latestClaims,
        summary: summarizeConsensus(status, missingReviewers, latestClaims),
      };
    });
}

export function applyPrReviewConsensusToHandoffs(
  activeContent: string,
  consensuses: PrReviewConsensus[],
): string {
  if (consensuses.length === 0) return activeContent;
  const byPr = new Map(consensuses.map(c => [c.prNumber, c]));
  return activeContent.split('\n').map(line => {
    const match = line.match(PR_HANDOFF_RE);
    if (!match) return line;
    const consensus = byPr.get(Number(match[2]));
    if (!consensus) return line;
    const cols = line.split('|');
    if (cols.length < 8) return line;
    const current = cols[4].trim();
    if (!REVIEW_STATUSES.includes(current)) return line;
    cols[4] = ` ${handoffStatusForConsensus(consensus.status)} `;
    return cols.join('|');
  }).join('\n');
}

export function reconcilePrReviewHandoffs(
  activeContent: string,
  assignments: Array<{ prNumber: number; reviewers: PrReviewer[] }>,
): string {
  if (assignments.length === 0) return activeContent;
  const allowedByPr = new Map(assignments.map(a => [a.prNumber, new Set(a.reviewers)]));
  const nextLines: string[] = [];

  for (const line of activeContent.split('\n')) {
    const match = line.match(PR_HANDOFF_RE);
    if (!match) {
      nextLines.push(line);
      continue;
    }
    const reviewer = normalizeReviewer(match[1]);
    const prNumber = Number(match[2]);
    const status = match[4].trim();
    const allowed = allowedByPr.get(prNumber);
    if (reviewer && allowed && REVIEW_STATUSES.includes(status) && !allowed.has(reviewer)) continue;
    nextLines.push(line);
  }

  return nextLines.join('\n');
}

export function runPrReviewConsensus(memoryDir: string): { updated: boolean; consensuses: PrReviewConsensus[] } {
  const activePath = path.join(memoryDir, 'handoffs', 'active.md');
  if (!existsSync(activePath)) return { updated: false, consensuses: [] };
  const activeContent = readFileSync(activePath, 'utf-8');
  const handoffs = parsePrReviewHandoffs(activeContent);
  if (handoffs.length === 0) return { updated: false, consensuses: [] };
  const claims = readPrReviewClaimsSync(memoryDir);
  const consensuses = evaluatePrReviewConsensus(handoffs, claims);
  const next = applyPrReviewConsensusToHandoffs(activeContent, consensuses);
  if (next !== activeContent) {
    writeFileSync(activePath, next, 'utf-8');
    return { updated: true, consensuses };
  }
  return { updated: false, consensuses };
}

export function createInternalPrReviewClaim(candidate: InternalPrReviewCandidate, now = new Date()): PrReviewClaim | null {
  if (candidate.reviewer === 'alex') return null;

  const text = `${candidate.title}\n${candidate.body ?? ''}`;
  if (requiresHumanPrReview(text)) return null;

  const changedFiles = uniqueStrings(candidate.changedFiles);
  const touchesCode = changedFiles.some(file => /^(src|tests|scripts|plugins|\.githooks)\//.test(file) || file === 'package.json');
  const hasVerification = /(^|\n)##\s+Verification\b/i.test(text)
    && /\b(pnpm|npm|npx|vitest|tsc|test|typecheck|build|passed|passes|clean|smoke|verified in an isolated worktree|runtime checkout was not used)\b/i.test(text);

  if (changedFiles.length === 0) {
    return createPrReviewClaim({
      prNumber: candidate.prNumber,
      reviewer: candidate.reviewer,
      framework: candidate.framework,
      verdict: 'comment',
      risk: 'medium',
      summary: 'Internal review could not inspect changed-file evidence yet.',
      evidence: ['missing changed-file list'],
      reviewInputHash: computePrReviewInputHash(candidate),
      headSha: candidate.headSha ?? undefined,
    }, now);
  }

  if (touchesCode && !hasVerification) {
    return createPrReviewClaim({
      prNumber: candidate.prNumber,
      reviewer: candidate.reviewer,
      framework: candidate.framework,
      verdict: 'request_changes',
      risk: 'medium',
      summary: 'Code-affecting PR is missing verification evidence in the PR body.',
      evidence: changedFiles.slice(0, 8),
      reviewInputHash: computePrReviewInputHash(candidate),
      headSha: candidate.headSha ?? undefined,
    }, now);
  }

  return createPrReviewClaim({
    prNumber: candidate.prNumber,
    reviewer: candidate.reviewer,
    framework: candidate.framework,
    verdict: 'approve',
    risk: candidate.framework === 'internal-governance' ? 'medium' : 'low',
    summary: `${candidate.reviewer} internal review approved: scoped diff with recorded verification evidence.`,
    evidence: [
      ...changedFiles.slice(0, 8),
      ...(hasVerification ? ['PR body includes verification evidence'] : []),
    ],
    reviewInputHash: computePrReviewInputHash(candidate),
    headSha: candidate.headSha ?? undefined,
  }, now);
}

export function appendMissingInternalPrReviewClaims(
  memoryDir: string,
  candidates: InternalPrReviewCandidate[],
  now = new Date(),
): InternalPrReviewClaimResult {
  const existing = readPrReviewClaimsSync(memoryDir);
  const seen = new Set(existing.map(reviewClaimKey));
  const created: PrReviewClaim[] = [];
  const skipped: InternalPrReviewClaimResult['skipped'] = [];

  for (const candidate of candidates) {
    const key = `${candidate.prNumber}:${candidate.reviewer}:${computePrReviewInputHash(candidate)}`;
    if (seen.has(key)) {
      skipped.push({ prNumber: candidate.prNumber, reviewer: candidate.reviewer, reason: 'claim already exists for this PR input' });
      continue;
    }
    const claim = createInternalPrReviewClaim(candidate, now);
    if (!claim) {
      skipped.push({ prNumber: candidate.prNumber, reviewer: candidate.reviewer, reason: 'human or unsupported reviewer' });
      continue;
    }
    appendPrReviewClaim(memoryDir, claim);
    seen.add(key);
    created.push(claim);
  }

  return { created, skipped };
}

function ensurePrReviewClaimsFile(memoryDir: string): string {
  const filePath = getPrReviewClaimsPath(memoryDir);
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(filePath)) writeFileSync(filePath, '', 'utf-8');
  return filePath;
}

function claimToRecord(claim: PrReviewClaim): Record<string, unknown> {
  return {
    type: 'pr_review_claim',
    id: claim.id,
    pr_number: claim.prNumber,
    reviewer: claim.reviewer,
    framework: claim.framework,
    verdict: claim.verdict,
    risk: claim.risk,
    summary: claim.summary,
    evidence: claim.evidence,
    review_input_hash: claim.reviewInputHash,
    head_sha: claim.headSha,
    created_at: claim.createdAt,
  };
}

function parseClaim(line: string): PrReviewClaim | null {
  if (!line.trim()) return null;
  try {
    const raw = JSON.parse(line) as Record<string, unknown>;
    const reviewer = normalizeReviewer(stringField(raw.reviewer));
    const framework = stringField(raw.framework) as PrReviewFramework;
    const verdict = stringField(raw.verdict) as PrReviewVerdict;
    const risk = stringField(raw.risk) as PrReviewClaim['risk'];
    const prNumber = Number(raw.pr_number ?? raw.prNumber);
    const id = stringField(raw.id);
    const summary = stringField(raw.summary);
    const createdAt = stringField(raw.created_at ?? raw.createdAt);
    const reviewInputHash = stringField(raw.review_input_hash ?? raw.reviewInputHash) || undefined;
    const headSha = stringField(raw.head_sha ?? raw.headSha) || undefined;
    if (!id || !reviewer || !framework || !['approve', 'request_changes', 'comment'].includes(verdict)) return null;
    if (!['low', 'medium', 'high'].includes(risk)) return null;
    if (!Number.isInteger(prNumber) || prNumber <= 0 || !summary || !createdAt) return null;
    const evidence = Array.isArray(raw.evidence)
      ? raw.evidence.filter((item): item is string => typeof item === 'string')
      : [];
    return { id, prNumber, reviewer, framework, verdict, risk, summary, evidence, reviewInputHash, headSha, createdAt };
  } catch {
    return null;
  }
}

function reviewClaimKey(claim: PrReviewClaim): string {
  return `${claim.prNumber}:${claim.reviewer}:${claim.reviewInputHash ?? 'legacy'}`;
}

function normalizeReviewer(value: string): PrReviewer | null {
  if (['codex', 'claude-code', 'akari', 'alex'].includes(value)) return value as PrReviewer;
  return null;
}

function latestClaimPerReviewer(claims: PrReviewClaim[]): PrReviewClaim[] {
  const latest = new Map<PrReviewer, PrReviewClaim>();
  for (const claim of [...claims].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    latest.set(claim.reviewer, claim);
  }
  return [...latest.values()].sort((a, b) => a.reviewer.localeCompare(b.reviewer));
}

function consensusStatus(
  requiredReviewers: PrReviewer[],
  claims: PrReviewClaim[],
  missingReviewers: PrReviewer[],
): PrReviewConsensusStatus {
  if (claims.some(c => c.verdict === 'request_changes')) return 'changes_requested';
  if (missingReviewers.length > 0) return claims.length > 0 ? 'commented' : 'pending';
  if (requiredReviewers.length > 0 && claims.every(c => c.verdict === 'approve')) return 'approved';
  if (claims.some(c => c.verdict === 'comment')) return 'commented';
  return 'pending';
}

function summarizeConsensus(
  status: PrReviewConsensusStatus,
  missingReviewers: PrReviewer[],
  claims: PrReviewClaim[],
): string {
  if (status === 'changes_requested') return 'at least one reviewer requested changes';
  if (status === 'approved') return 'all required reviewers approved';
  if (missingReviewers.length > 0) return `waiting for ${missingReviewers.join(', ')}`;
  if (claims.length > 0) return 'review comments received; no approval consensus yet';
  return 'waiting for review claims';
}

function handoffStatusForConsensus(status: PrReviewConsensusStatus): string {
  if (status === 'approved') return 'review-approved';
  if (status === 'changes_requested') return 'changes-requested';
  if (status === 'commented') return 'review-pending';
  return 'needs-review';
}

function uniqueReviewers(values: PrReviewer[]): PrReviewer[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
