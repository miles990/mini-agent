import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { appendMemoryIndexEntry, queryMemoryIndexSync } from './memory-index.js';
import { classifyProviderResourceHold, type ProviderResourceHold } from './provider-resource-guard.js';
import {
  recordDelegationFailure,
  transitionDelegationFailureStatus,
  type DelegationFailureStatus,
} from './delegation-failure-guard.js';
import { slog } from './utils.js';

const LEDGER_FILE = 'middleware-failure-classifications.jsonl';

export interface MiddlewareTaskRecord {
  id?: string;
  worker?: string;
  status?: string;
  submittedAt?: string;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  error?: string;
  result?: string;
  task?: string;
}

export type MiddlewareFailureBucket =
  | 'budget-or-quota'
  | 'max-turns'
  | 'stall-or-timeout'
  | 'offline'
  | 'cancelled'
  | 'workspace-isolation'
  | 'other';

export interface MiddlewareFailureClassification {
  taskId: string;
  worker: string;
  bucket: MiddlewareFailureBucket;
  status: 'classified' | 'held';
  seenAt: string;
  providerHold?: ProviderResourceHold;
  providerHoldTaskId?: string;
  delegationFailureSignature?: string;
}

export interface MiddlewareFailureSweepResult {
  scanned: number;
  failed: number;
  classified: number;
  held: number;
  skippedKnown: number;
}

export async function sweepMiddlewareFailures(
  memoryDir: string,
  options: {
    tasks?: MiddlewareTaskRecord[];
    baseUrl?: string;
    timeoutMs?: number;
    now?: Date;
  } = {},
): Promise<MiddlewareFailureSweepResult> {
  const now = options.now ?? new Date();
  const tasks = options.tasks ?? await fetchMiddlewareTasks(options.baseUrl, options.timeoutMs ?? 2500);
  return classifyMiddlewareFailures(memoryDir, tasks, now);
}

export async function classifyMiddlewareFailures(
  memoryDir: string,
  tasks: MiddlewareTaskRecord[],
  now = new Date(),
): Promise<MiddlewareFailureSweepResult> {
  const known = new Set(readMiddlewareFailureClassificationsSync(memoryDir).map(record => record.taskId));
  const failedTasks = tasks.filter(task => task.status === 'failed' && task.id);
  const result: MiddlewareFailureSweepResult = {
    scanned: tasks.length,
    failed: failedTasks.length,
    classified: 0,
    held: 0,
    skippedKnown: 0,
  };

  for (const task of failedTasks) {
    const taskId = task.id as string;
    if (known.has(taskId)) {
      result.skippedKnown++;
      continue;
    }

    const text = failureText(task);
    const bucket = classifyMiddlewareFailureBucket(text);
    const providerHold = classifyProviderResourceHold(text, now) ?? undefined;
    const delegationDecision = recordDelegationFailure(memoryDir, {
      taskId,
      taskType: `middleware:${task.worker ?? 'unknown'}`,
      prompt: String(task.task ?? '').slice(0, 500),
      output: text,
    }, now);

    let providerHoldTaskId: string | undefined;
    let status: MiddlewareFailureClassification['status'] = 'classified';
    let delegationStatus: DelegationFailureStatus = 'resolved';
    let resolution = `middleware failed task classified as ${bucket}`;

    if (providerHold) {
      providerHoldTaskId = await ensureProviderHoldTask(memoryDir, providerHold, task, now);
      status = 'held';
      result.held++;
      resolution = `${resolution}; provider held until ${providerHold.resumeAt}; holdTask=${providerHoldTaskId}`;
    } else if (bucket === 'max-turns') {
      resolution = `${resolution}; terminal max-turn failure should be retried only after task decomposition or prompt/context shrink`;
    } else if (bucket === 'offline' || bucket === 'stall-or-timeout') {
      delegationStatus = 'needs_human';
      resolution = `${resolution}; middleware lane needs operator inspection before retry`;
    }

    transitionDelegationFailureStatus(
      memoryDir,
      delegationDecision.record.signature,
      delegationStatus,
      resolution,
      now,
    );

    appendMiddlewareFailureClassification(memoryDir, {
      taskId,
      worker: task.worker ?? 'unknown',
      bucket,
      status,
      seenAt: now.toISOString(),
      ...(providerHold ? { providerHold } : {}),
      ...(providerHoldTaskId ? { providerHoldTaskId } : {}),
      delegationFailureSignature: delegationDecision.record.signature,
    });
    result.classified++;
  }

  if (result.classified > 0) {
    slog('MIDDLEWARE-SELF-HEAL', `classified ${result.classified}/${result.failed} failed middleware task(s), held=${result.held}`);
  }
  return result;
}

export function getMiddlewareFailureClassificationPath(memoryDir: string): string {
  return path.join(memoryDir, 'index', LEDGER_FILE);
}

export function readMiddlewareFailureClassificationsSync(memoryDir: string): MiddlewareFailureClassification[] {
  const filePath = ensureLedger(memoryDir);
  const latest = new Map<string, MiddlewareFailureClassification>();
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const record = parseClassification(trimmed);
    if (record) latest.set(record.taskId, record);
  }
  return [...latest.values()].sort((a, b) => b.seenAt.localeCompare(a.seenAt));
}

export function readClassifiedMiddlewareTaskIds(memoryDir: string): Set<string> {
  return new Set(readMiddlewareFailureClassificationsSync(memoryDir).map(record => record.taskId));
}

export function classifyMiddlewareFailureBucket(text: string): MiddlewareFailureBucket {
  const lower = text.toLowerCase();
  if (/maximum budget|out of extra usage|usage limit|quota|rate.?limit/.test(lower)) return 'budget-or-quota';
  if (/maximum number of turns|max turns/.test(lower)) return 'max-turns';
  if (/stall|no activity|timeout|did not complete/.test(lower)) return 'stall-or-timeout';
  if (/offline|econnrefused|fetch failed/.test(lower)) return 'offline';
  if (/aborted by user|cancelled/.test(lower)) return 'cancelled';
  if (/workspace isolation|forge worktree/.test(lower)) return 'workspace-isolation';
  return 'other';
}

function appendMiddlewareFailureClassification(memoryDir: string, record: MiddlewareFailureClassification): void {
  appendFileSync(ensureLedger(memoryDir), JSON.stringify(record) + '\n', 'utf-8');
}

function ensureLedger(memoryDir: string): string {
  const filePath = getMiddlewareFailureClassificationPath(memoryDir);
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(filePath)) writeFileSync(filePath, '', 'utf-8');
  return filePath;
}

function parseClassification(line: string): MiddlewareFailureClassification | null {
  try {
    const raw = JSON.parse(line) as Record<string, unknown>;
    if (typeof raw.taskId !== 'string' || typeof raw.worker !== 'string' || typeof raw.seenAt !== 'string') return null;
    const bucket = raw.bucket;
    if (!isMiddlewareFailureBucket(bucket)) return null;
    const status = raw.status === 'held' ? 'held' : 'classified';
    return {
      taskId: raw.taskId,
      worker: raw.worker,
      bucket,
      status,
      seenAt: raw.seenAt,
      ...(isProviderHold(raw.providerHold) ? { providerHold: raw.providerHold } : {}),
      ...(typeof raw.providerHoldTaskId === 'string' ? { providerHoldTaskId: raw.providerHoldTaskId } : {}),
      ...(typeof raw.delegationFailureSignature === 'string' ? { delegationFailureSignature: raw.delegationFailureSignature } : {}),
    };
  } catch {
    return null;
  }
}

async function ensureProviderHoldTask(
  memoryDir: string,
  hold: ProviderResourceHold,
  task: MiddlewareTaskRecord,
  now: Date,
): Promise<string> {
  const active = queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['hold'] })
    .find(entry => {
      const current = entry.payload?.provider_resource_hold as ProviderResourceHold | undefined;
      if (!current || current.type !== 'provider-quota') return false;
      if (current.provider !== hold.provider) return false;
      const resumeAt = Date.parse(current.resumeAt);
      return Number.isFinite(resumeAt) && resumeAt > now.getTime();
    });
  if (active) return active.id;

  const entry = await appendMemoryIndexEntry(memoryDir, {
    type: 'task',
    status: 'hold',
    summary: `Hold ${hold.provider} middleware delegation until provider quota resets`,
    refs: [],
    tags: ['middleware', 'provider-hold', 'self-healing'],
    payload: {
      origin: 'middleware-self-healing',
      holdCondition: {
        type: 'date-after',
        value: hold.resumeAt,
      },
      provider_resource_hold: hold,
      middleware_task_id: task.id,
      middleware_worker: task.worker,
      middleware_failure_bucket: 'budget-or-quota',
      createdAt: now.toISOString(),
    },
  });
  return entry.id;
}

async function fetchMiddlewareTasks(baseUrl?: string, timeoutMs = 2500): Promise<MiddlewareTaskRecord[]> {
  const url = `${(baseUrl ?? process.env.MIDDLEWARE_URL ?? 'http://127.0.0.1:3200').replace(/\/+$/, '')}/tasks`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return [];
    const body = await response.json() as unknown;
    const record = body as Record<string, unknown>;
    if (Array.isArray(record.tasks)) return record.tasks as MiddlewareTaskRecord[];
    if (Array.isArray(body)) return body as MiddlewareTaskRecord[];
    return [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function failureText(task: MiddlewareTaskRecord): string {
  return [
    task.error,
    task.result,
    task.task,
  ].filter(value => typeof value === 'string' && value.trim()).join('\n').slice(0, 4000);
}

function isMiddlewareFailureBucket(value: unknown): value is MiddlewareFailureBucket {
  return value === 'budget-or-quota'
    || value === 'max-turns'
    || value === 'stall-or-timeout'
    || value === 'offline'
    || value === 'cancelled'
    || value === 'workspace-isolation'
    || value === 'other';
}

function isProviderHold(value: unknown): value is ProviderResourceHold {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  return raw.type === 'provider-quota'
    && (raw.provider === 'claude' || raw.provider === 'codex' || raw.provider === 'unknown')
    && typeof raw.resumeAt === 'string'
    && typeof raw.reason === 'string';
}
