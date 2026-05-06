import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { getMemoryRootDir } from './memory-paths.js';
import type { MemoryRepoFileStat } from './memory-repo-policy.js';

export type KGPromotionStatus = 'candidate' | 'dry-run' | 'promoted' | 'failed' | 'skipped';

export interface KGPromotionCandidate {
  relPath: string;
  absPath: string;
  bytes: number;
  title: string;
  sha1: string;
  charCount: number;
  confidence: number;
  scope: 'private' | 'shared-candidate';
  reason: string;
  description: string;
}

export interface KGPromotionTriple {
  subject: string;
  subject_type: string;
  predicate: string;
  object: string;
  object_type: string;
  confidence: number;
  source_agent: string;
  description: string;
  namespace: string;
  properties: Record<string, unknown>;
}

export interface KGPromotionRecord {
  ts: string;
  status: KGPromotionStatus;
  relPath: string;
  title: string;
  sha1: string;
  confidence: number;
  scope: KGPromotionCandidate['scope'];
  kgUrl?: string;
  namespace?: string;
  sourceAgent?: string;
  tripleSubject?: string;
  error?: string;
}

export interface KGPromotionSummary {
  total: number;
  candidates: number;
  dryRun: number;
  promoted: number;
  failed: number;
  skipped: number;
  latestAt: string | null;
}

const DESC_CAP = 2000;

export function getKGPromotionLedgerPath(memoryDir = getMemoryRootDir()): string {
  return path.join(memoryDir, 'index', 'kg-promotions.jsonl');
}

export function buildKGPromotionCandidates(
  memoryDir: string,
  files: MemoryRepoFileStat[],
  limit = 20,
): KGPromotionCandidate[] {
  const candidates: KGPromotionCandidate[] = [];
  for (const file of files.slice(0, Math.max(0, limit))) {
    const absPath = path.join(memoryDir, file.relPath);
    let content: string;
    try {
      content = fs.readFileSync(absPath, 'utf-8');
    } catch {
      continue;
    }
    const trimmed = content.trim();
    if (trimmed.length < 80) continue;
    candidates.push({
      relPath: file.relPath,
      absPath,
      bytes: file.bytes,
      title: extractTitle(trimmed, file.relPath),
      sha1: hashText(trimmed),
      charCount: trimmed.length,
      confidence: confidenceForPath(file.relPath),
      scope: scopeForPath(file.relPath),
      reason: reasonForPath(file.relPath),
      description: trimmed.slice(0, DESC_CAP),
    });
  }
  return candidates;
}

export function candidateToKGTriple(
  candidate: KGPromotionCandidate,
  opts: { namespace?: string; sourceAgent?: string } = {},
): KGPromotionTriple {
  const namespace = opts.namespace ?? 'kuro';
  const sourceAgent = opts.sourceAgent ?? 'kuro';
  return {
    subject: candidate.title,
    subject_type: 'concept',
    predicate: 'context_anchor_for',
    object: 'mini-agent-memory',
    object_type: 'project',
    confidence: candidate.confidence,
    source_agent: sourceAgent,
    description: candidate.description,
    namespace,
    properties: {
      source_file: candidate.relPath,
      source_sha1: candidate.sha1,
      provenance: 'memory-repo',
      epistemic_status: 'candidate',
      scope: candidate.scope,
      promotion_reason: candidate.reason,
      char_count: candidate.charCount,
      bytes: candidate.bytes,
      memory_type: 'curated-markdown',
    },
  };
}

export function appendKGPromotionRecord(memoryDir: string, record: KGPromotionRecord): void {
  const ledgerPath = getKGPromotionLedgerPath(memoryDir);
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, `${JSON.stringify(record)}\n`, 'utf-8');
}

export function readKGPromotionRecords(memoryDir = getMemoryRootDir(), limit = 50): KGPromotionRecord[] {
  const ledgerPath = getKGPromotionLedgerPath(memoryDir);
  if (!fs.existsSync(ledgerPath)) return [];
  const lines = fs.readFileSync(ledgerPath, 'utf-8').trim().split('\n').filter(Boolean);
  const records: KGPromotionRecord[] = [];
  for (const line of lines.slice(Math.max(0, lines.length - limit))) {
    try {
      records.push(JSON.parse(line) as KGPromotionRecord);
    } catch {
      // Skip malformed manual edits.
    }
  }
  return records.reverse();
}

export function summarizeKGPromotions(records: KGPromotionRecord[]): KGPromotionSummary {
  const summary: KGPromotionSummary = {
    total: records.length,
    candidates: 0,
    dryRun: 0,
    promoted: 0,
    failed: 0,
    skipped: 0,
    latestAt: records[0]?.ts ?? null,
  };
  for (const record of records) {
    if (record.status === 'candidate') summary.candidates++;
    else if (record.status === 'dry-run') summary.dryRun++;
    else if (record.status === 'promoted') summary.promoted++;
    else if (record.status === 'failed') summary.failed++;
    else if (record.status === 'skipped') summary.skipped++;
  }
  return summary;
}

function extractTitle(content: string, relPath: string): string {
  const firstHeading = content.split('\n').find(line => /^#\s+/.test(line.trim()));
  if (firstHeading) return firstHeading.replace(/^#+\s*/, '').trim().slice(0, 160);
  return relPath.replace(/\.md$/, '').split('/').join(':').slice(0, 160);
}

function hashText(text: string): string {
  return createHash('sha1').update(text).digest('hex');
}

function confidenceForPath(relPath: string): number {
  if (/^(MEMORY|SOUL|HEARTBEAT|NEXT)\.md$/.test(relPath)) return 0.85;
  if (/^(reports|reviews|handoffs)\//.test(relPath)) return 0.8;
  if (/^(proposals|research|learning|discussions)\//.test(relPath)) return 0.75;
  return 0.72;
}

function scopeForPath(relPath: string): KGPromotionCandidate['scope'] {
  if (/^(handoffs|reports|reviews|proposals|research|learning|discussions)\//.test(relPath)) {
    return 'shared-candidate';
  }
  return 'private';
}

function reasonForPath(relPath: string): string {
  if (/^(MEMORY|SOUL|HEARTBEAT|NEXT)\.md$/.test(relPath)) return 'core durable memory file';
  if (relPath.startsWith('topics/')) return 'topic memory with reusable behavior or concept links';
  if (relPath.startsWith('handoffs/')) return 'cross-agent handoff context';
  if (relPath.startsWith('reports/')) return 'auditable maintenance or verification report';
  if (relPath.startsWith('proposals/')) return 'decision candidate with design context';
  return 'curated markdown candidate';
}
