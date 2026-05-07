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

export type MiddlewareFailureLifecycleAction =
  | 'provider-hold'
  | 'decompose'
  | 'recover-lane'
  | 'repair-workspace'
  | 'triage'
  | 'terminal-cancelled';

export interface MiddlewareFailureClassification {
  taskId: string;
  worker: string;
  bucket: MiddlewareFailureBucket;
  status: 'classified' | 'held';
  seenAt: string;
  providerHold?: ProviderResourceHold;
  providerHoldTaskId?: string;
  followUpTaskId?: string;
  delegationFailureSignature?: string;
  lifecycleAction?: MiddlewareFailureLifecycleAction;
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
  const known = new Map(readMiddlewareFailureClassificationsSync(memoryDir).map(record => [record.taskId, record]));
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
    const text = failureOutputText(task);
    const bucket = classifyMiddlewareFailureBucket(text);
    const providerHold = classifyProviderResourceHold(text, now) ?? undefined;
    const status: MiddlewareFailureClassification['status'] = providerHold ? 'held' : 'classified';
    const existing = known.get(taskId);
    if (existing && existing.bucket === bucket && existing.status === status) {
      result.skippedKnown++;
      continue;
    }

    const delegationDecision = recordDelegationFailure(memoryDir, {
      taskId,
      taskType: `middleware:${task.worker ?? 'unknown'}`,
      prompt: String(task.task ?? '').slice(0, 500),
      output: text,
    }, now);

    let providerHoldTaskId: string | undefined;
    let followUpTaskId: string | undefined;
    let delegationStatus: DelegationFailureStatus = 'resolved';
    let resolution = `middleware failed task classified as ${bucket}`;
    let lifecycleAction: MiddlewareFailureLifecycleAction = 'triage';

    if (providerHold) {
      providerHoldTaskId = await ensureProviderHoldTask(memoryDir, providerHold, task, now);
      result.held++;
      lifecycleAction = 'provider-hold';
      resolution = `${resolution}; provider held until ${providerHold.resumeAt}; holdTask=${providerHoldTaskId}`;
    } else if (bucket === 'max-turns') {
      followUpTaskId = await ensureMiddlewareFailureFollowUpTask(memoryDir, bucket, task, now);
      lifecycleAction = 'decompose';
      resolution = `${resolution}; created decomposition follow-up ${followUpTaskId}`;
    } else if (bucket === 'offline' || bucket === 'stall-or-timeout') {
      followUpTaskId = await ensureMiddlewareFailureFollowUpTask(memoryDir, bucket, task, now);
      delegationStatus = 'needs_human';
      lifecycleAction = 'recover-lane';
      resolution = `${resolution}; created lane recovery follow-up ${followUpTaskId}`;
    } else if (bucket === 'workspace-isolation' || bucket === 'other') {
      followUpTaskId = await ensureMiddlewareFailureFollowUpTask(memoryDir, bucket, task, now);
      lifecycleAction = bucket === 'workspace-isolation' ? 'repair-workspace' : 'triage';
      resolution = `${resolution}; created repair follow-up ${followUpTaskId}`;
    } else if (bucket === 'cancelled') {
      lifecycleAction = 'terminal-cancelled';
      resolution = `${resolution}; user/system cancellation treated as terminal unless it recurs`;
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
      ...(followUpTaskId ? { followUpTaskId } : {}),
      delegationFailureSignature: delegationDecision.record.signature,
      lifecycleAction,
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
      ...(typeof raw.followUpTaskId === 'string' ? { followUpTaskId: raw.followUpTaskId } : {}),
      ...(typeof raw.delegationFailureSignature === 'string' ? { delegationFailureSignature: raw.delegationFailureSignature } : {}),
      ...(isMiddlewareFailureLifecycleAction(raw.lifecycleAction) ? { lifecycleAction: raw.lifecycleAction } : {}),
    };
  } catch {
    return null;
  }
}

function isMiddlewareFailureLifecycleAction(value: unknown): value is MiddlewareFailureLifecycleAction {
  return value === 'provider-hold'
    || value === 'decompose'
    || value === 'recover-lane'
    || value === 'repair-workspace'
    || value === 'triage'
    || value === 'terminal-cancelled';
}

async function ensureMiddlewareFailureFollowUpTask(
  memoryDir: string,
  bucket: MiddlewareFailureBucket,
  task: MiddlewareTaskRecord,
  now: Date,
): Promise<string> {
  const taskId = task.id ?? 'unknown';
  const active = queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending', 'in_progress', 'hold'] })
    .find(entry => {
      const payload = (entry.payload ?? {}) as Record<string, unknown>;
      return payload.origin === 'middleware-self-healing'
        && payload.middleware_failure_task_id === taskId
        && payload.middleware_failure_bucket === bucket;
    });
  if (active) return active.id;

  const plan = middlewareFailureRepairPlan(bucket, task);
  try {
    const entry = await appendMemoryIndexEntry(memoryDir, {
      type: 'task',
      status: plan.status,
      summary: plan.summary,
      refs: [],
      tags: ['middleware', 'self-healing', bucket],
      payload: {
        origin: 'middleware-self-healing',
        middleware_failure_task_id: taskId,
        middleware_worker: task.worker,
        middleware_failure_bucket: bucket,
        failed_task_excerpt: String(task.task ?? '').slice(0, 500),
        acceptance_criteria: plan.acceptance,
        createdAt: now.toISOString(),
      },
    });
    return entry.id;
  } catch (error) {
    if (/duplicate/i.test(String(error))) {
      const duplicate = findMiddlewareFailureFollowUp(memoryDir, plan.summary, taskId, bucket);
      return duplicate?.id ?? 'duplicate-existing-task';
    }
    throw error;
  }
}

function findMiddlewareFailureFollowUp(
  memoryDir: string,
  summary: string,
  taskId: string,
  bucket: MiddlewareFailureBucket,
): { id: string } | undefined {
  const normalized = summary.toLowerCase().trim();
  return queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending', 'in_progress', 'hold', 'completed'] })
    .find(entry => {
      const payload = (entry.payload ?? {}) as Record<string, unknown>;
      if (payload.middleware_failure_task_id === taskId && payload.middleware_failure_bucket === bucket) return true;
      const entrySummary = String(entry.summary ?? '').toLowerCase().trim();
      if (entrySummary === normalized) return true;
      if (normalized.length >= 20 && entrySummary.includes(normalized.slice(0, 40))) return true;
      return entrySummary.length >= 20 && normalized.includes(entrySummary.slice(0, 40));
    });
}

function middlewareFailureRepairPlan(
  bucket: MiddlewareFailureBucket,
  task: MiddlewareTaskRecord,
): { status: 'pending' | 'hold'; summary: string; acceptance: string } {
  const worker = task.worker ?? 'unknown worker';
  if (bucket === 'max-turns') {
    return {
      status: 'pending',
      summary: `Decompose middleware task ${task.id ?? 'unknown'} after max-turns failure`,
      acceptance: 'Original delegation is split into smaller tasks or retry policy marks it terminal with evidence.',
    };
  }
  if (bucket === 'offline' || bucket === 'stall-or-timeout') {
    return {
      status: 'pending',
      summary: `Recover middleware ${worker} lane after ${bucket} failure`,
      acceptance: 'Middleware lane health probe passes, circuit breaker/backoff is updated, or lane is intentionally held.',
    };
  }
  if (bucket === 'workspace-isolation') {
    return {
      status: 'pending',
      summary: `Repair middleware workspace isolation for task ${task.id ?? 'unknown'}`,
      acceptance: 'Worker retry uses an isolated worktree with required dependencies or records a durable bypass policy.',
    };
  }
  return {
    status: 'pending',
    summary: `Triage middleware failed task ${task.id ?? 'unknown'} (${bucket})`,
    acceptance: 'Failure is assigned to a known bucket, retried safely, held with a resume condition, or closed as terminal.',
  };
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

function failureOutputText(task: MiddlewareTaskRecord): string {
  const output = [
    task.error,
    task.result,
  ].filter(value => typeof value === 'string' && value.trim()).join('\n').slice(0, 4000);
  if (output) return output;
  return String(task.task ?? '').slice(0, 4000);
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
