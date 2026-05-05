/**
 * Delegation Failure Guard — detect repeated middleware failures.
 *
 * Claims say what failed after the fact. This guard turns repeated failures
 * into control flow: stop retrying the same task unchanged and ask Kuro to
 * diagnose the failure mode first.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const FAILURE_GUARD_FILE = 'delegation-failures.jsonl';
const REPEAT_THRESHOLD = 2;

export type DelegationFailureStatus = 'open' | 'diagnosing' | 'resolved' | 'ignored' | 'needs_human';

export interface DelegationFailureRecord {
  signature: string;
  taskId: string;
  taskType?: string;
  prompt: string;
  error: string;
  frequency: number;
  status: DelegationFailureStatus;
  firstSeen: string;
  lastSeen: string;
  diagnosticTaskId?: string;
  resolution?: string;
  resolvedAt?: string;
}

export interface DelegationFailureDecision {
  record: DelegationFailureRecord;
  repeated: boolean;
  needsDiagnosticTask: boolean;
}

export function getDelegationFailureGuardPath(memoryDir: string): string {
  return path.join(memoryDir, 'index', FAILURE_GUARD_FILE);
}

export function recordDelegationFailure(
  memoryDir: string,
  input: {
    taskId: string;
    taskType?: string;
    prompt: string;
    output: string;
  },
  now = new Date(),
): DelegationFailureDecision {
  const latest = readLatestRecords(memoryDir);
  const signature = failureSignature(input.taskType, input.prompt, input.output);
  const existing = latest.get(signature);
  const timestamp = now.toISOString();
  const record: DelegationFailureRecord = existing
    ? {
      ...existing,
      taskId: input.taskId,
      taskType: input.taskType,
      prompt: input.prompt.slice(0, 500),
      error: failureError(input.output),
      frequency: existing.frequency + 1,
      status: shouldReopen(existing.status) ? 'open' : existing.status,
      lastSeen: timestamp,
    }
    : {
      signature,
      taskId: input.taskId,
      taskType: input.taskType,
      prompt: input.prompt.slice(0, 500),
      error: failureError(input.output),
      frequency: 1,
      status: 'open',
      firstSeen: timestamp,
      lastSeen: timestamp,
    };

  appendRecord(memoryDir, record);
  return {
    record,
    repeated: record.frequency >= REPEAT_THRESHOLD,
    needsDiagnosticTask: record.status === 'open' && record.frequency >= REPEAT_THRESHOLD && !record.diagnosticTaskId,
  };
}

export function markDelegationFailureDiagnosticCreated(
  memoryDir: string,
  signature: string,
  diagnosticTaskId: string,
): DelegationFailureRecord | null {
  const current = readLatestRecords(memoryDir).get(signature);
  if (!current) return null;
  const updated = {
    ...current,
    diagnosticTaskId,
    status: current.status === 'open' ? 'diagnosing' as const : current.status,
    lastSeen: new Date().toISOString(),
  };
  appendRecord(memoryDir, updated);
  return updated;
}

export function readDelegationFailureRecordsSync(memoryDir: string): DelegationFailureRecord[] {
  return [...readLatestRecords(memoryDir).values()]
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen));
}

export function transitionDelegationFailureStatus(
  memoryDir: string,
  signature: string,
  status: DelegationFailureStatus,
  resolution?: string,
  now = new Date(),
): DelegationFailureRecord | null {
  const current = readLatestRecords(memoryDir).get(signature);
  if (!current) return null;
  const timestamp = now.toISOString();
  const updated: DelegationFailureRecord = {
    ...current,
    status,
    lastSeen: timestamp,
    ...(resolution !== undefined ? { resolution: resolution.slice(0, 500) } : {}),
    ...(['resolved', 'ignored', 'needs_human'].includes(status) ? { resolvedAt: timestamp } : {}),
  };
  appendRecord(memoryDir, updated);
  return updated;
}

function readLatestRecords(memoryDir: string): Map<string, DelegationFailureRecord> {
  const filePath = ensureLedger(memoryDir);
  const latest = new Map<string, DelegationFailureRecord>();
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const record = parseRecord(trimmed);
    if (record) latest.set(record.signature, record);
  }
  return latest;
}

function appendRecord(memoryDir: string, record: DelegationFailureRecord): void {
  appendFileSync(ensureLedger(memoryDir), JSON.stringify(record) + '\n', 'utf-8');
}

function ensureLedger(memoryDir: string): string {
  const filePath = getDelegationFailureGuardPath(memoryDir);
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(filePath)) writeFileSync(filePath, '', 'utf-8');
  return filePath;
}

function parseRecord(line: string): DelegationFailureRecord | null {
  try {
    const raw = JSON.parse(line) as Record<string, unknown>;
    const signature = stringField(raw.signature);
    const taskId = stringField(raw.taskId);
    const prompt = stringField(raw.prompt);
    const error = stringField(raw.error);
    const firstSeen = stringField(raw.firstSeen);
    const lastSeen = stringField(raw.lastSeen);
    const frequency = typeof raw.frequency === 'number' ? raw.frequency : 0;
    if (!signature || !taskId || !prompt || !error || !firstSeen || !lastSeen || frequency <= 0) return null;
    const status = isDelegationFailureStatus(raw.status) ? raw.status : 'open';
    return {
      signature,
      taskId,
      prompt,
      error,
      frequency,
      status,
      firstSeen,
      lastSeen,
      ...(typeof raw.taskType === 'string' ? { taskType: raw.taskType } : {}),
      ...(typeof raw.diagnosticTaskId === 'string' ? { diagnosticTaskId: raw.diagnosticTaskId } : {}),
      ...(typeof raw.resolution === 'string' ? { resolution: raw.resolution } : {}),
      ...(typeof raw.resolvedAt === 'string' ? { resolvedAt: raw.resolvedAt } : {}),
    };
  } catch {
    return null;
  }
}

function failureSignature(taskType: string | undefined, prompt: string, output: string): string {
  const error = failureError(output)
    .toLowerCase()
    .replace(/del-\d+-[a-z0-9]+/g, 'del-*')
    .replace(/task-\d+-[a-z0-9]+/g, 'task-*')
    .replace(/\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}\.\d{3}z/gi, '<ts>')
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
  const promptKey = prompt
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return `${taskType ?? 'unknown'}:${promptKey}:${error}`;
}

function failureError(output: string): string {
  return output
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500) || '(no output)';
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function isDelegationFailureStatus(value: unknown): value is DelegationFailureStatus {
  return typeof value === 'string'
    && ['open', 'diagnosing', 'resolved', 'ignored', 'needs_human'].includes(value);
}

function shouldReopen(status: DelegationFailureStatus): boolean {
  return status === 'resolved' || status === 'ignored';
}
