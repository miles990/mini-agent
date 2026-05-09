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

export function getDelegationFailureCode(signature: string): string {
  let hash = 0;
  for (let i = 0; i < signature.length; i++) {
    hash = ((hash << 5) - hash + signature.charCodeAt(i)) | 0;
  }
  return `fail-${Math.abs(hash).toString(36).slice(0, 6)}`;
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
  const keepTerminalResolved = existing ? shouldKeepTerminalResolution(existing, input.output) : false;
  const reopened = existing && !keepTerminalResolved ? shouldReopen(existing.status) : false;
  const record: DelegationFailureRecord = existing
    ? {
      ...existing,
      taskId: input.taskId,
      taskType: input.taskType,
      prompt: input.prompt.slice(0, 500),
      error: failureError(input.output),
      frequency: existing.frequency + 1,
      status: keepTerminalResolved ? existing.status : reopened ? 'open' : existing.status,
      lastSeen: timestamp,
      ...(reopened ? { resolution: undefined, resolvedAt: undefined } : {}),
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
    const rawStatus = isDelegationFailureStatus(raw.status) ? raw.status : 'open';
    const resolution = typeof raw.resolution === 'string' ? raw.resolution : undefined;
    const resolvedAt = typeof raw.resolvedAt === 'string' ? raw.resolvedAt : undefined;
    const status = resolvedAt && (rawStatus === 'open' || rawStatus === 'diagnosing')
      ? 'resolved'
      : rawStatus;
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
      ...(resolution ? { resolution } : {}),
      ...(resolvedAt ? { resolvedAt } : {}),
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

export function isActionableDelegationFailure(record: DelegationFailureRecord): boolean {
  if (record.status === 'resolved' || record.status === 'ignored') return false;
  return record.frequency >= REPEAT_THRESHOLD
    || record.status === 'diagnosing'
    || record.status === 'needs_human'
    || Boolean(record.diagnosticTaskId);
}

function shouldReopen(status: DelegationFailureStatus): boolean {
  return status === 'resolved' || status === 'ignored';
}

function shouldKeepTerminalResolution(existing: DelegationFailureRecord, output: string): boolean {
  if (!['resolved', 'ignored'].includes(existing.status)) return false;
  const resolution = (existing.resolution ?? '').toLowerCase();
  const error = failureError(output).toLowerCase();
  const isMaxTurns = /maximum number of turns|max turns|reached maximum number of turns/.test(error);
  const terminalResolution = /terminal telemetry|do not retry the same prompt unchanged|split the origin task|decompose/.test(resolution);
  return isMaxTurns && terminalResolution;
}
