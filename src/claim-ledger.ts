/**
 * Claim Ledger — append-only provider claim store.
 *
 * File = truth. Same-id-last-wins gives us reversible status transitions while
 * keeping every assertion traceable back to the provider and task that made it.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  claimToKgRecord,
  transitionClaimStatus,
  type ClaimStatus,
  type ProviderClaim,
} from './provider-claims.js';

const CLAIM_LEDGER_FILE = 'provider-claims.jsonl';

export interface ClaimLedgerQuery {
  provider?: string | string[];
  taskId?: string;
  status?: ClaimStatus | ClaimStatus[];
  subject?: string;
  limit?: number;
}

export function getClaimLedgerPath(memoryDir: string): string {
  return path.join(memoryDir, 'index', CLAIM_LEDGER_FILE);
}

export function appendProviderClaim(memoryDir: string, claim: ProviderClaim): ProviderClaim {
  const filePath = ensureClaimLedger(memoryDir);
  appendFileSync(filePath, JSON.stringify(claimToKgRecord(claim)) + '\n', 'utf-8');
  return claim;
}

export function readProviderClaimsSync(memoryDir: string, query: ClaimLedgerQuery = {}): ProviderClaim[] {
  const filePath = ensureClaimLedger(memoryDir);
  const latest = new Map<string, ProviderClaim>();

  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const claim = parseClaimRecord(trimmed);
    if (!claim) continue;
    latest.set(claim.id, claim);
  }

  let claims = [...latest.values()];
  const providers = asList(query.provider);
  const statuses = asList(query.status);

  if (providers.length > 0) claims = claims.filter(c => providers.includes(c.provider));
  if (query.taskId) claims = claims.filter(c => c.taskId === query.taskId);
  if (statuses.length > 0) claims = claims.filter(c => statuses.includes(c.status));
  if (query.subject) claims = claims.filter(c => c.subject === query.subject);

  claims.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (query.limit !== undefined) claims = claims.slice(0, query.limit);
  return claims;
}

export function transitionStoredProviderClaim(
  memoryDir: string,
  claimId: string,
  nextStatus: ClaimStatus,
  now = new Date(),
): ProviderClaim | null {
  const current = readProviderClaimsSync(memoryDir).find(c => c.id === claimId);
  if (!current) return null;
  return appendProviderClaim(memoryDir, transitionClaimStatus(current, nextStatus, now));
}

export function getRecentClaimsSummary(memoryDir: string, limit = 5): string | null {
  const claims = readProviderClaimsSync(memoryDir, { limit });
  if (claims.length === 0) return null;

  const lines = claims.map(claim => {
    const confidence = claim.confidence === undefined ? '' : ` conf=${claim.confidence.toFixed(2)}`;
    return `  [${claim.status}] ${claim.provider} ${claim.predicate} ${claim.subject}: ${claim.object.slice(0, 180)}${confidence}`;
  });
  return `Provider claims (${claims.length} recent):\n${lines.join('\n')}`;
}

function ensureClaimLedger(memoryDir: string): string {
  const filePath = getClaimLedgerPath(memoryDir);
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(filePath)) writeFileSync(filePath, '', 'utf-8');
  return filePath;
}

function parseClaimRecord(line: string): ProviderClaim | null {
  try {
    const raw = JSON.parse(line) as Record<string, unknown>;
    const id = stringField(raw.id);
    const provider = stringField(raw.provider);
    const taskId = stringField(raw.task_id ?? raw.taskId);
    const subject = stringField(raw.subject);
    const predicate = stringField(raw.predicate);
    const object = stringField(raw.object);
    const status = stringField(raw.status) as ClaimStatus | '';
    const createdAt = stringField(raw.created_at ?? raw.createdAt);
    const updatedAt = stringField(raw.updated_at ?? raw.updatedAt);
    if (!id || !provider || !taskId || !subject || !predicate || !object || !status || !createdAt || !updatedAt) {
      return null;
    }
    if (!['hypothesis', 'verified', 'rejected', 'superseded', 'disputed'].includes(status)) return null;

    const evidence = Array.isArray(raw.evidence)
      ? raw.evidence.filter((item): item is string => typeof item === 'string')
      : [];
    const confidence = typeof raw.confidence === 'number' ? raw.confidence : undefined;

    return {
      id,
      provider: provider as ProviderClaim['provider'],
      taskId,
      subject,
      predicate,
      object,
      evidence,
      confidence,
      status,
      createdAt,
      updatedAt,
    };
  } catch {
    return null;
  }
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asList<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}
