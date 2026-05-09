import { execFileSync } from 'node:child_process';
import {
  classifyMiddlewareFailureBucket,
  isTerminalBrainMaxTurnText,
  type MiddlewareTaskRecord,
} from './middleware-failure-self-healing.js';

export interface MiddlewareQualityHealthResult {
  status: 'ok' | 'warn' | 'blocked';
  summary: string;
  evidence: string[];
  repair?: string;
}

export interface MiddlewareQualityOptions {
  baseUrl?: string;
  now?: Date;
  timeoutSeconds?: number;
  warnFailedRatio?: number;
  blockFailedRatio?: number;
  warnRunningMinutes?: number;
  blockRunningMinutes?: number;
  /**
   * Failed tasks whose `completedAt` is older than this many minutes are
   * treated as historical residue (stale) and excluded from the active
   * `failed`/`failedRatio` gating. They are still surfaced in evidence as
   * `staleFailed=N` so operators can see them. Default: 20 minutes.
   *
   * Rationale: middleware archives terminal tasks after 1h. During the gap
   * between failure and archive, already-known failed tasks were holding
   * the autonomy-closure gate open, blocking new repair work that the gate
   * itself was telling us to do.
   */
  staleFailedMinutes?: number;
  classifiedFailedTaskIds?: Iterable<string>;
  tasks?: MiddlewareTaskRecord[];
}

export function evaluateMiddlewareQuality(options: MiddlewareQualityOptions = {}): MiddlewareQualityHealthResult {
  if (process.env.MINI_AGENT_DISABLE_MIDDLEWARE_QUALITY_CLOSURE === '1') {
    return {
      status: 'ok',
      summary: 'middleware quality closure disabled by environment',
      evidence: [],
    };
  }

  if (options.tasks) {
    return evaluateTaskQuality(options.tasks, ['middlewareUrl=injected', 'status=injected'], options);
  }

  const baseUrl = (options.baseUrl ?? process.env.MIDDLEWARE_URL ?? 'http://127.0.0.1:3200').replace(/\/+$/, '');
  const timeout = options.timeoutSeconds ?? 2;
  const health = curlJson(`${baseUrl}/health`, timeout);
  if (!health.ok) {
    return {
      status: 'warn',
      summary: 'middleware is unreachable',
      evidence: [`middlewareUrl=${baseUrl}`, health.error ?? 'unknown curl failure'],
      repair: 'Restart agent-middleware or hold middleware-backed delegation until /health and /tasks are reachable.',
    };
  }

  const healthBody = health.value as Record<string, unknown>;
  const tasksResponse = curlJson(`${baseUrl}/tasks`, timeout);
  const evidence = [
    `middlewareUrl=${baseUrl}`,
    `status=${String(healthBody.status ?? 'unknown')}`,
    `workers=${Array.isArray(healthBody.workers) ? healthBody.workers.length : 'unknown'}`,
    `healthTasks=${String(healthBody.tasks ?? 'unknown')}`,
  ];

  if (!tasksResponse.ok) {
    return {
      status: 'warn',
      summary: 'middleware is reachable but task quality is not queryable',
      evidence: [...evidence, `tasks=unreachable:${tasksResponse.error ?? 'unknown'}`],
      repair: 'Restore middleware /tasks visibility so failed, stalled, and budget-exhausted work can be closed instead of accumulating silently.',
    };
  }

  const tasks = extractTasks(tasksResponse.value);
  return evaluateTaskQuality(tasks, evidence, options);
}

function evaluateTaskQuality(
  tasks: MiddlewareTaskRecord[],
  evidence: string[],
  options: MiddlewareQualityOptions,
): MiddlewareQualityHealthResult {
  const now = options.now ?? new Date();
  const staleFailedMinutes = options.staleFailedMinutes ?? 20;
  const classifiedFailedTaskIds = new Set(options.classifiedFailedTaskIds ?? []);
  const { activeFailed, staleFailed, classifiedFailed, terminalFailed } = partitionFailedByRecency(
    tasks,
    now,
    staleFailedMinutes,
    classifiedFailedTaskIds,
  );

  // Treat the in-flight task population as "everything except stale-failed
  // residue". Stale residue still gets reported, but it doesn't gate new work.
  const activeTotal = tasks.length - staleFailed.length - classifiedFailed.length - terminalFailed.length;
  const counts = countStatuses(tasks);
  const failed = activeFailed.length;
  const running = counts.running ?? 0;
  const failedRatio = activeTotal > 0 ? failed / activeTotal : 0;
  const staleRunning = findStaleRunning(tasks, now, options.warnRunningMinutes ?? 45);
  const blockedRunning = findStaleRunning(tasks, now, options.blockRunningMinutes ?? 120);
  const failureBuckets = bucketFailures(activeFailed);

  evidence.push(`tasks=${tasks.length}`);
  evidence.push(`activeTasks=${activeTotal}`);
  evidence.push(`running=${running}`);
  evidence.push(`failed=${failed}`);
  evidence.push(`failedRatio=${failedRatio.toFixed(2)}`);
  if (staleFailed.length > 0) {
    evidence.push(`staleFailed=${staleFailed.length}>${staleFailedMinutes}m`);
  }
  if (classifiedFailed.length > 0) {
    evidence.push(`classifiedFailed=${classifiedFailed.length}`);
  }
  if (terminalFailed.length > 0) {
    evidence.push(`terminalFailed=${terminalFailed.length}`);
  }
  if (Object.keys(failureBuckets).length > 0) {
    evidence.push(`failureBuckets=${Object.entries(failureBuckets).map(([k, v]) => `${k}:${v}`).join(',')}`);
  }
  evidence.push(...staleRunning.slice(0, 5).map(task => `staleRunning=${formatTask(task, now)}`));
  evidence.push(...activeFailed.slice(-5).map(task => `failedTask=${formatTask(task, now)}`));

  if (blockedRunning.length > 0) {
    return {
      status: 'blocked',
      summary: `${blockedRunning.length} middleware task(s) have been running longer than ${options.blockRunningMinutes ?? 120}m`,
      evidence,
      repair: 'Cancel or diagnose stale middleware tasks, then make the originating scheduler/delegation task terminal or smaller.',
    };
  }

  if (failedRatio >= (options.blockFailedRatio ?? 0.6) && failed >= 5) {
    return {
      status: 'blocked',
      summary: `middleware failure ratio is ${(failedRatio * 100).toFixed(0)}% (${failed}/${activeTotal})`,
      evidence,
      repair: 'Hold new middleware-backed work, classify dominant failure buckets, and repair provider budget, max-turn, or shell-stall causes before retrying.',
    };
  }

  if (failedRatio >= (options.warnFailedRatio ?? 0.2) && failed >= 3) {
    return {
      status: 'warn',
      summary: `middleware quality degraded: ${failed}/${activeTotal} task(s) failed`,
      evidence,
      repair: 'Diagnose the dominant middleware failure buckets and close or suppress stale failed tasks before dispatching more autonomous repair work.',
    };
  }

  if (staleRunning.length > 0) {
    return {
      status: 'warn',
      summary: `${staleRunning.length} middleware task(s) are running longer than ${options.warnRunningMinutes ?? 45}m`,
      evidence,
      repair: 'Inspect long-running middleware tasks and cancel, split, or checkpoint them before they become silent stalls.',
    };
  }

  return {
    status: 'ok',
    summary: `middleware quality healthy: ${activeTotal} task(s), ${failed} failed`,
    evidence,
  };
}

function extractTasks(value: unknown): MiddlewareTaskRecord[] {
  const record = value as Record<string, unknown>;
  if (Array.isArray(record?.tasks)) return record.tasks as MiddlewareTaskRecord[];
  if (Array.isArray(value)) return value as MiddlewareTaskRecord[];
  return [];
}

function countStatuses(tasks: MiddlewareTaskRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const task of tasks) {
    const status = task.status ?? 'unknown';
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

function partitionFailedByRecency(
  tasks: MiddlewareTaskRecord[],
  now: Date,
  staleMinutes: number,
  classifiedTaskIds: Set<string> = new Set(),
): {
  activeFailed: MiddlewareTaskRecord[];
  staleFailed: MiddlewareTaskRecord[];
  classifiedFailed: MiddlewareTaskRecord[];
  terminalFailed: MiddlewareTaskRecord[];
} {
  const thresholdMs = staleMinutes * 60 * 1000;
  const activeFailed: MiddlewareTaskRecord[] = [];
  const staleFailed: MiddlewareTaskRecord[] = [];
  const classifiedFailed: MiddlewareTaskRecord[] = [];
  const terminalFailed: MiddlewareTaskRecord[] = [];
  for (const task of tasks) {
    if (task.status !== 'failed') continue;
    if (isTerminalBrainMaxTurnFailure(task)) {
      terminalFailed.push(task);
      continue;
    }
    if (task.id && classifiedTaskIds.has(task.id)) {
      classifiedFailed.push(task);
      continue;
    }
    const completedSource = task.completedAt ?? task.updatedAt ?? task.startedAt ?? task.submittedAt;
    const completedAt = completedSource ? Date.parse(completedSource) : NaN;
    if (Number.isFinite(completedAt) && now.getTime() - completedAt > thresholdMs) {
      staleFailed.push(task);
    } else {
      activeFailed.push(task);
    }
  }
  return { activeFailed, staleFailed, classifiedFailed, terminalFailed };
}

function isTerminalBrainMaxTurnFailure(task: MiddlewareTaskRecord): boolean {
  const text = [
    task.task,
    task.error,
    task.result,
  ].filter(value => typeof value === 'string' && value.trim()).join('\n');
  return classifyMiddlewareFailureBucket(text) === 'max-turns'
    && isTerminalBrainMaxTurnText(task.worker ?? '', text);
}

function findStaleRunning(tasks: MiddlewareTaskRecord[], now: Date, maxMinutes: number): MiddlewareTaskRecord[] {
  const thresholdMs = maxMinutes * 60 * 1000;
  return tasks.filter(task => {
    if (task.status !== 'running') return false;
    const startedAt = Date.parse(String(task.startedAt ?? task.submittedAt ?? task.updatedAt ?? ''));
    return Number.isFinite(startedAt) && now.getTime() - startedAt > thresholdMs;
  });
}

function bucketFailures(tasks: MiddlewareTaskRecord[]): Record<string, number> {
  const buckets: Record<string, number> = {};
  for (const task of tasks) {
    if (task.status !== 'failed') continue;
    const bucket = classifyMiddlewareFailureBucket(`${task.error ?? ''}\n${task.result ?? ''}`);
    buckets[bucket] = (buckets[bucket] ?? 0) + 1;
  }
  return buckets;
}

function formatTask(task: MiddlewareTaskRecord, now: Date): string {
  const ageSource = task.startedAt ?? task.submittedAt ?? task.updatedAt;
  const ageMs = ageSource ? now.getTime() - Date.parse(ageSource) : NaN;
  const age = Number.isFinite(ageMs) ? `${Math.max(0, ageMs / 60000).toFixed(0)}m` : 'unknown-age';
  const msg = String(task.error ?? task.result ?? task.task ?? '').replace(/\s+/g, ' ').slice(0, 90);
  return `${task.id ?? 'unknown'} ${task.worker ?? 'unknown'} ${task.status ?? 'unknown'} ${age}${msg ? ` ${msg}` : ''}`;
}

function curlJson(url: string, timeoutSeconds: number): { ok: true; value: unknown } | { ok: false; error?: string } {
  try {
    const stdout = execFileSync('curl', ['-sS', '--max-time', String(timeoutSeconds), url], {
      encoding: 'utf-8',
      timeout: (timeoutSeconds + 1) * 1000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, value: JSON.parse(stdout) };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 200) };
  }
}
