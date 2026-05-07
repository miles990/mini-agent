import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { getAgentOwnedIdentity, type AgentOwnedService } from './agent-owned-identity.js';

const LEDGER_FILE = 'public-write-provenance.jsonl';

export type PublicWriteStatus = 'open' | 'resolved' | 'acknowledged';

export interface PublicWriteProvenanceInput {
  service: AgentOwnedService;
  action: string;
  subject: string;
  actualActor: string;
  expectedActor?: string;
  intentActor?: 'kuro' | 'alex' | 'human' | string;
  source?: string;
  status?: PublicWriteStatus;
  resolution?: string;
  observedAt?: Date;
  evidence?: string[];
}

export interface PublicWriteProvenanceRecord {
  id: string;
  observedAt: string;
  service: AgentOwnedService;
  action: string;
  subject: string;
  expectedActor: string;
  actualActor: string;
  intentActor: string;
  source: string;
  status: PublicWriteStatus;
  resolution?: string;
  evidence: string[];
}

export interface PublicWriteIdentitySnapshot {
  status: 'ok' | 'warn' | 'blocked';
  expected: Record<string, string>;
  openMismatches: PublicWriteProvenanceRecord[];
  unknownActors: PublicWriteProvenanceRecord[];
  recent: PublicWriteProvenanceRecord[];
  summary: string;
}

export function recordPublicWriteProvenance(
  memoryDir: string,
  input: PublicWriteProvenanceInput,
  env: NodeJS.ProcessEnv = process.env,
): PublicWriteProvenanceRecord {
  const identity = getAgentOwnedIdentity(input.service, env);
  const record: PublicWriteProvenanceRecord = {
    id: `pub-${randomUUID()}`,
    observedAt: (input.observedAt ?? new Date()).toISOString(),
    service: input.service,
    action: input.action,
    subject: input.subject,
    expectedActor: normalizeActor(input.service, input.expectedActor ?? identity.expected),
    actualActor: normalizeActor(input.service, input.actualActor),
    intentActor: input.intentActor ?? 'kuro',
    source: input.source ?? 'runtime',
    status: input.status ?? 'open',
    ...(input.resolution ? { resolution: input.resolution } : {}),
    evidence: input.evidence ?? [],
  };
  appendFileSync(ensureLedger(memoryDir), JSON.stringify(record) + '\n', 'utf-8');
  return record;
}

export function readPublicWriteProvenanceSync(memoryDir: string): PublicWriteProvenanceRecord[] {
  const filePath = ensureLedger(memoryDir);
  const latest = new Map<string, PublicWriteProvenanceRecord>();
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const record = JSON.parse(trimmed) as PublicWriteProvenanceRecord;
      if (!record.id || !record.service || !record.action) continue;
      latest.set(record.id, {
        ...record,
        evidence: Array.isArray(record.evidence) ? record.evidence : [],
      });
    } catch {
      // Ignore partial JSONL writes.
    }
  }
  return [...latest.values()].sort((a, b) => b.observedAt.localeCompare(a.observedAt));
}

export function evaluatePublicWriteIdentity(
  memoryDir: string,
  env: NodeJS.ProcessEnv = process.env,
): PublicWriteIdentitySnapshot {
  const recent = readPublicWriteProvenanceSync(memoryDir).slice(0, 50);
  const expected: Record<string, string> = {};
  for (const record of recent) {
    try {
      expected[record.service] = getAgentOwnedIdentity(record.service, env).expected;
    } catch {
      expected[record.service] = record.expectedActor;
    }
  }

  const active = recent.filter(record => record.status === 'open' && record.intentActor === 'kuro');
  const openMismatches = active.filter(record =>
    normalizeActor(record.service, record.actualActor) !== normalizeActor(record.service, record.expectedActor),
  );
  const unknownActors = active.filter(record => !record.actualActor || record.actualActor === 'unknown');
  const status = openMismatches.length > 0 ? 'blocked' : unknownActors.length > 0 ? 'warn' : 'ok';
  const summary = status === 'blocked'
    ? `${openMismatches.length} Kuro public write(s) used the wrong account`
    : status === 'warn'
      ? `${unknownActors.length} Kuro public write(s) have unverified account provenance`
      : `${recent.length} public write provenance record(s), no open mismatch`;

  return { status, expected, openMismatches, unknownActors, recent, summary };
}

export function publicWriteLedgerPath(memoryDir: string): string {
  return path.join(memoryDir, 'index', LEDGER_FILE);
}

export function normalizeActor(service: string, value: string): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return 'unknown';
  if (service === 'github') return trimmed.replace(/^@/, '').replace(/\/+$/, '').split('/').pop()?.replace(/\.git$/, '') ?? trimmed;
  if (service === 'x' || service === 'devto') return trimmed.replace(/^@/, '').replace(/\/+$/, '').split('/').pop()?.replace(/^@/, '') ?? trimmed;
  return trimmed.toLowerCase();
}

function ensureLedger(memoryDir: string): string {
  const dir = path.join(memoryDir, 'index');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, LEDGER_FILE);
  if (!existsSync(filePath)) appendFileSync(filePath, '', 'utf-8');
  return filePath;
}
