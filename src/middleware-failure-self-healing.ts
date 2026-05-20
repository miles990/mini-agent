import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { appendMemoryIndexEntry, queryMemoryIndexSync, updateMemoryIndexEntry } from './memory-index.js';
import { classifyProviderResourceHold, type ProviderResourceHold } from './provider-resource-guard.js';
import { forgeStatus } from './forge.js';
import {
  recordDelegationFailure,
  readDelegationFailureRecordsSync,
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
  | 'provider-hold-fallback'
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

export interface MiddlewareFailureRetryEnvelope {
  strategy: 'decompose-and-retry' | 'compressed-provider-resume' | 'bounded-shell-probe' | 'lane-recovery' | 'workspace-retry' | 'triage';
  worker: string;
  prompt: string;
  acceptance: string;
  maxTurns?: number;
  timeoutMs?: number;
  progressTimeoutMs?: number;
  commandSlices?: string[];
  notes: string[];
}

export interface MiddlewareFailureSweepResult {
  scanned: number;
  failed: number;
  classified: number;
  held: number;
  skippedKnown: number;
  playbookUpgraded: number;
  recoveredOffline: number;
  recoveredWorkspaceIsolation: number;
}

export async function sweepMiddlewareFailures(
  memoryDir: string,
  options: {
    tasks?: MiddlewareTaskRecord[];
    baseUrl?: string;
    workdir?: string;
    timeoutMs?: number;
    now?: Date;
  } = {},
): Promise<MiddlewareFailureSweepResult> {
  const now = options.now ?? new Date();
  const tasks = options.tasks ?? await fetchMiddlewareTasks(options.baseUrl, options.timeoutMs ?? 2500);
  const result = await classifyMiddlewareFailures(memoryDir, tasks, now);
  if (tasks.length > 0) result.recoveredOffline += reconcileRecoveredOfflineDelegationFailures(memoryDir, now);
  if (options.workdir) {
    result.recoveredWorkspaceIsolation += reconcileRecoveredWorkspaceIsolationDelegationFailures(memoryDir, options.workdir, now);
  }
  return result;
}

export async function classifyMiddlewareFailures(
  memoryDir: string,
  tasks: MiddlewareTaskRecord[],
  now = new Date(),
): Promise<MiddlewareFailureSweepResult> {
  await closeTerminalBrainMaxTurnFollowUps(memoryDir, now);
  const known = new Map(readMiddlewareFailureClassificationsSync(memoryDir).map(record => [record.taskId, record]));
  const failedTasks = tasks.filter(task => task.status === 'failed' && task.id);
  const result: MiddlewareFailureSweepResult = {
    scanned: tasks.length,
    failed: failedTasks.length,
    classified: 0,
    held: 0,
    skippedKnown: 0,
    playbookUpgraded: 0,
    recoveredOffline: 0,
    recoveredWorkspaceIsolation: 0,
  };

  for (const task of failedTasks) {
    const taskId = task.id as string;
    const text = failureOutputText(task);
    const bucket = classifyMiddlewareFailureBucket(text);
    const providerHold = classifyProviderResourceHold(text, now) ?? undefined;
    const status: MiddlewareFailureClassification['status'] = providerHold ? 'held' : 'classified';
    const existing = known.get(taskId);
    if (existing && existing.bucket === bucket && existing.status === status) {
      if (providerHold) {
        await closeSupersededTriageFollowUps(memoryDir, taskId, providerHold, now);
      }
      if (await upgradeMissingFailurePlaybook(memoryDir, existing, task, now)) {
        result.playbookUpgraded++;
      }
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
      await closeSupersededTriageFollowUps(memoryDir, taskId, providerHold, now);
      providerHoldTaskId = await ensureProviderHoldTask(memoryDir, providerHold, task, now);
      followUpTaskId = await ensureMiddlewareFailureFollowUpTask(memoryDir, bucket, task, now);
      result.held++;
      lifecycleAction = 'provider-hold-fallback';
      resolution = `${resolution}; provider held until ${providerHold.resumeAt}; holdTask=${providerHoldTaskId}; fallbackTask=${followUpTaskId}`;
    } else if (bucket === 'max-turns' && isTerminalBrainMaxTurnTask(task)) {
      lifecycleAction = 'terminal-cancelled';
      resolution = `${resolution}; brain-provider max-turns is terminal telemetry, not a decomposable work item`;
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

async function upgradeMissingFailurePlaybook(
  memoryDir: string,
  existing: MiddlewareFailureClassification,
  task: MiddlewareTaskRecord,
  now: Date,
): Promise<boolean> {
  if (existing.followUpTaskId) return false;
  if (existing.bucket === 'cancelled') return false;
  if (existing.bucket === 'max-turns' && isTerminalBrainMaxTurnTask(task)) return false;

  const followUpTaskId = await ensureMiddlewareFailureFollowUpTask(memoryDir, existing.bucket, task, now);
  appendMiddlewareFailureClassification(memoryDir, {
    ...existing,
    seenAt: now.toISOString(),
    followUpTaskId,
    lifecycleAction: upgradedLifecycleAction(existing.bucket, existing.lifecycleAction),
  });
  return true;
}

function upgradedLifecycleAction(
  bucket: MiddlewareFailureBucket,
  current: MiddlewareFailureLifecycleAction | undefined,
): MiddlewareFailureLifecycleAction {
  if (bucket === 'budget-or-quota') return 'provider-hold-fallback';
  if (bucket === 'max-turns') return 'decompose';
  if (bucket === 'offline' || bucket === 'stall-or-timeout') return 'recover-lane';
  if (bucket === 'workspace-isolation') return 'repair-workspace';
  return current ?? 'triage';
}

async function closeSupersededTriageFollowUps(
  memoryDir: string,
  taskId: string,
  hold: ProviderResourceHold,
  now: Date,
): Promise<number> {
  const stale = queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending', 'in_progress'] })
    .filter(entry => entry.summary === `Triage middleware failed task ${taskId} (other)`);
  let closed = 0;
  for (const entry of stale) {
    const updated = await updateMemoryIndexEntry(memoryDir, entry.id, {
      status: 'hold',
      tags: Array.from(new Set([...(entry.tags ?? []), 'middleware', 'provider-hold', 'superseded-triage'])),
      payload: {
        ...(entry.payload ?? {}),
        supersededBy: 'provider-resource-hold',
        provider_resource_hold: hold,
        updatedAt: now.toISOString(),
      },
    });
    if (updated) closed++;
  }
  return closed;
}

export function reconcileRecoveredOfflineDelegationFailures(memoryDir: string, now = new Date()): number {
  let resolved = 0;
  for (const failure of readDelegationFailureRecordsSync(memoryDir)) {
    if (!['open', 'diagnosing', 'needs_human'].includes(failure.status)) continue;
    if (classifyMiddlewareFailureBucket(failure.error) !== 'offline') continue;
    const updated = transitionDelegationFailureStatus(
      memoryDir,
      failure.signature,
      'resolved',
      'middleware health probe is reachable again; historical offline delegation failure closed by self-healing sweep',
      now,
    );
    if (updated) resolved++;
  }
  return resolved;
}

export function reconcileRecoveredWorkspaceIsolationDelegationFailures(
  memoryDir: string,
  workdir: string,
  now = new Date(),
): number {
  const status = forgeStatus(workdir);
  if (!status || status.free <= 0) return 0;

  let resolved = 0;
  for (const failure of readDelegationFailureRecordsSync(memoryDir)) {
    if (!['open', 'diagnosing', 'needs_human'].includes(failure.status)) continue;
    if (classifyMiddlewareFailureBucket(failure.error) !== 'workspace-isolation') continue;
    const updated = transitionDelegationFailureStatus(
      memoryDir,
      failure.signature,
      'resolved',
      `forge status reports ${status.free}/${status.total} free slot(s); historical workspace-isolation failure closed by self-healing sweep`,
      now,
    );
    if (updated) resolved++;
  }
  return resolved;
}

export async function closeTerminalBrainMaxTurnFollowUps(memoryDir: string, now = new Date()): Promise<number> {
  const followUps = queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending', 'in_progress', 'hold'] })
    .filter(entry => {
      const payload = (entry.payload ?? {}) as Record<string, unknown>;
      return payload.origin === 'middleware-self-healing'
        && payload.middleware_failure_bucket === 'max-turns'
        && isTerminalBrainMaxTurnText(String(payload.middleware_worker ?? ''), String(payload.failed_task_excerpt ?? ''));
    });

  let closed = 0;
  for (const entry of followUps) {
    const payload = (entry.payload ?? {}) as Record<string, unknown>;
    const updated = await updateMemoryIndexEntry(memoryDir, entry.id, {
      status: 'completed',
      payload: {
        ...payload,
        terminal_resolution: 'brain-provider max-turns is terminal telemetry, not decomposable work',
        terminal_resolved_at: now.toISOString(),
      },
      tags: [...new Set([...(entry.tags ?? []), 'terminal-cancelled'])],
    });
    if (updated) closed++;
  }
  return closed;
}

const STALE_BUDGET_HOLD_MS = 6 * 60 * 60 * 1000; // 6 hours

export async function closeStaleProviderBudgetFollowUps(memoryDir: string, now = new Date()): Promise<number> {
  const followUps = queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending', 'in_progress', 'hold'] })
    .filter(entry => {
      const payload = (entry.payload ?? {}) as Record<string, unknown>;
      return payload.origin === 'middleware-self-healing'
        && payload.middleware_failure_bucket === 'budget-or-quota';
    });

  let closed = 0;
  for (const entry of followUps) {
    const payload = (entry.payload ?? {}) as Record<string, unknown>;
    const createdAt = typeof payload.createdAt === 'string' ? new Date(payload.createdAt).getTime() : 0;
    if (createdAt > 0 && (now.getTime() - createdAt) < STALE_BUDGET_HOLD_MS) continue;

    const updated = await updateMemoryIndexEntry(memoryDir, entry.id, {
      status: 'completed',
      payload: {
        ...payload,
        terminal_resolution: 'provider budget hold expired without retry — original context is stale',
        terminal_resolved_at: now.toISOString(),
      },
      tags: [...new Set([...(entry.tags ?? []), 'stale-budget-expired'])],
    });
    if (updated) closed++;
  }
  if (closed > 0) {
    slog('MIDDLEWARE-SELF-HEAL', `closed ${closed} stale provider-budget follow-up task(s)`);
  }
  return closed;
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
  if (/maximum budget|out of extra usage|usage limit|hit your limit|quota|rate.?limit/.test(lower)) return 'budget-or-quota';
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
    || value === 'provider-hold-fallback'
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
        retry_envelope: plan.retryEnvelope,
        priority: bucket === 'budget-or-quota' ? 1 : 0,
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
): { status: 'pending' | 'hold'; summary: string; acceptance: string; retryEnvelope: MiddlewareFailureRetryEnvelope } {
  const worker = task.worker ?? 'unknown worker';
  const taskId = task.id ?? 'unknown';
  const excerpt = compactTaskText(task.task ?? '');
  if (bucket === 'max-turns') {
    const acceptance = 'A bounded retry plan exists with 1-3 independent slices, each slice has its own verification, and the original broad prompt is not retried unchanged.';
    return {
      status: 'pending',
      summary: `Retry middleware task ${taskId} as bounded slices after max-turns failure`,
      acceptance,
      retryEnvelope: {
        strategy: 'decompose-and-retry',
        worker,
        prompt: [
          'Do not retry the failed broad task unchanged.',
          'First identify the smallest independently verifiable slice, then execute only that slice.',
          'If code changes are needed, name exact files before editing and stop after one coherent patch.',
          excerpt,
        ].filter(Boolean).join('\n\n'),
        acceptance,
        maxTurns: 8,
        timeoutMs: 240_000,
        notes: [
          'max-turns means the task was too broad for the selected actor, not that more waiting helps',
          'prefer a mechanical probe or file-scope slice over another full-context LLM pass',
        ],
      },
    };
  }
  if (bucket === 'budget-or-quota') {
    const acceptance = 'Provider-bound work is resumed only after quota reset with compressed context, or a cheaper/local fallback produces the next concrete artifact.';
    return {
      status: 'pending',
      summary: `Create fallback for middleware task ${taskId} after provider budget hold`,
      acceptance,
      retryEnvelope: {
        strategy: 'compressed-provider-resume',
        worker,
        prompt: [
          'Do not spend another full provider run on the same context.',
          'Summarize prior state into <=1200 chars, list the next single action, and prefer local/shell evidence before LLM work.',
          excerpt,
        ].filter(Boolean).join('\n\n'),
        acceptance,
        maxTurns: 6,
        timeoutMs: 180_000,
        notes: [
          'budget exhaustion is a resource constraint; useful work should continue via compression, local probes, or waiting for reset',
          'resume task must not duplicate the held provider request',
        ],
      },
    };
  }
  if (bucket === 'stall-or-timeout') {
    const acceptance = 'The failed shell/task chain is split into bounded probes with checkpoints; no single silent step may run for 1800s again.';
    return {
      status: 'pending',
      summary: `Retry middleware ${worker} lane with bounded probes after timeout`,
      acceptance,
      retryEnvelope: {
        strategy: worker === 'shell' ? 'bounded-shell-probe' : 'lane-recovery',
        worker,
        prompt: [
          'Break the failed work into bounded probes. Emit progress after each probe.',
          'For shell commands, run each command slice separately and persist intermediate artifacts before continuing.',
          excerpt,
        ].filter(Boolean).join('\n\n'),
        acceptance,
        timeoutMs: 120_000,
        progressTimeoutMs: 60_000,
        commandSlices: splitShellCommand(task.task ?? ''),
        notes: [
          'timeout/stall requires shorter probes and progress checkpoints, not a longer timeout',
          'only increase timeout after a probe proves the command is making progress',
        ],
      },
    };
  }
  if (bucket === 'offline') {
    const acceptance = 'Middleware health probe passes and the original task is retried only after lane availability is confirmed.';
    return {
      status: 'pending',
      summary: `Recover middleware ${worker} lane after offline failure`,
      acceptance,
      retryEnvelope: {
        strategy: 'lane-recovery',
        worker,
        prompt: 'Probe middleware /health and worker availability, then release or recreate the original task with the smallest safe retry envelope.',
        acceptance,
        timeoutMs: 60_000,
        progressTimeoutMs: 30_000,
        notes: ['offline failures should close automatically once health is back; repeated offline means service supervision is broken'],
      },
    };
  }
  if (bucket === 'workspace-isolation') {
    const acceptance = 'Forge has a free slot and the retry uses an isolated worktree; if allocation still fails, the forge error is captured with stderr.';
    return {
      status: 'pending',
      summary: `Repair middleware workspace isolation for task ${taskId}`,
      acceptance,
      retryEnvelope: {
        strategy: 'workspace-retry',
        worker,
        prompt: 'Probe forge status, allocate a fresh worktree, and retry only after the isolated worktree is available.',
        acceptance,
        timeoutMs: 180_000,
        notes: ['workspace write retries must never fall back to runtime checkout writes'],
      },
    };
  }
  const acceptance = 'Failure is assigned to a known bucket, retried safely, held with a resume condition, or closed as terminal.';
  return {
    status: 'pending',
    summary: `Triage middleware failed task ${taskId} (${bucket})`,
    acceptance,
    retryEnvelope: {
      strategy: 'triage',
      worker,
      prompt: `Classify this failure and produce one mechanical next action:\n\n${excerpt}`,
      acceptance,
      timeoutMs: 120_000,
      notes: ['unknown failures must become a named bucket before broad retry'],
    },
  };
}

function compactTaskText(task: string): string {
  return String(task).replace(/\s+/g, ' ').trim().slice(0, 1200);
}

function splitShellCommand(task: string): string[] | undefined {
  const slices = String(task)
    .split(/\s+&&\s+|\s*;\s*/g)
    .map(part => part.trim())
    .filter(Boolean)
    .slice(0, 8);
  return slices.length > 1 ? slices : undefined;
}

function isTerminalBrainMaxTurnTask(task: MiddlewareTaskRecord): boolean {
  return isTerminalBrainMaxTurnText(task.worker ?? '', [
    task.task,
    failureOutputText(task),
  ].filter(value => typeof value === 'string' && value.trim()).join('\n'));
}

export function isTerminalBrainMaxTurnText(worker: string, text: string): boolean {
  const lower = `${worker}\n${text}`.toLowerCase();
  return worker.toLowerCase() === 'agent-brain'
    || /mini-agent delegated brain provider/.test(lower)
    || /return the requested result with concise evidence/.test(lower)
    || /you are i'm kuro, alex's personal ai assistant/.test(lower);
}

async function ensureProviderHoldTask(
  memoryDir: string,
  hold: ProviderResourceHold,
  task: MiddlewareTaskRecord,
  now: Date,
): Promise<string> {
  const active = findProviderHoldTask(memoryDir, hold, now);
  if (active) return active.id;

  try {
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
  } catch (error) {
    if (/duplicate/i.test(String(error))) {
      return findProviderHoldTask(memoryDir, hold, now)?.id ?? 'duplicate-existing-provider-hold';
    }
    throw error;
  }
}

function findProviderHoldTask(
  memoryDir: string,
  hold: ProviderResourceHold,
  now: Date,
): { id: string } | undefined {
  return queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['hold'] })
    .find(entry => {
      const current = entry.payload?.provider_resource_hold as ProviderResourceHold | undefined;
      if (!current || current.type !== 'provider-quota') return false;
      if (current.provider !== hold.provider) return false;
      const resumeAt = Date.parse(current.resumeAt);
      return Number.isFinite(resumeAt) && resumeAt > now.getTime();
    });
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
