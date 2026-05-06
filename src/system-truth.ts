import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { evaluateAutonomyClosure } from './autonomy-closure-health.js';
import { getFeature } from './features.js';
import { queryMemoryIndexSync, type MemoryIndexEntry } from './memory-index.js';

export type TruthSeverity = 'info' | 'warn' | 'blocker';
export type TruthStatus = 'healthy' | 'degraded' | 'blocked';

export interface TruthFinding {
  severity: TruthSeverity;
  kind:
    | 'local-task-backlog'
    | 'middleware-offline'
    | 'middleware-active-backlog'
    | 'middleware-duplicate-active'
    | 'middleware-stale-active'
    | 'middleware-unreviewed-completed'
    | 'kg-offline'
    | 'kg-retrieval-disabled'
    | 'kg-push-low-signal'
    | 'closure-health';
  summary: string;
  evidence: string[];
  recommendation?: string;
}

export interface MiddlewareTaskTruth {
  id: string;
  worker: string;
  status: string;
  durationMs?: number;
  startedAt?: string;
  completedAt?: string;
  task: string;
}

export interface MiddlewareCommitmentTruth {
  id: string;
  status: string;
  owner?: string;
  created_at: string;
  text: string;
  linked_task_id?: string;
}

export interface KnowledgeGraphTruth {
  online: boolean;
  health?: Record<string, unknown>;
  maintenanceScore?: number;
  retrievalAugmentEnabled: boolean;
  pushSample?: string;
  error?: string;
}

export interface SystemTruthSnapshot {
  status: TruthStatus;
  generatedAt: string;
  score: number;
  counts: {
    localActiveTasks: number;
    middlewareActiveCommitments: number | null;
    middlewareRunningTasks: number | null;
    middlewareUnreviewedCompletedTasks: number | null;
    kgNodes: number | null;
    kgEdges: number | null;
  };
  local: {
    activeTasks: Array<Pick<MemoryIndexEntry, 'id' | 'status' | 'summary' | 'ts' | 'payload'>>;
    autonomyStatus: ReturnType<typeof evaluateAutonomyClosure>['status'];
    autonomyScore: number;
  };
  middleware: {
    online: boolean;
    health?: Record<string, unknown>;
    activeCommitments: MiddlewareCommitmentTruth[];
    recentTasks: MiddlewareTaskTruth[];
    error?: string;
  };
  kg: KnowledgeGraphTruth;
  findings: TruthFinding[];
}

export interface SystemTruthApplyAction {
  commitmentId: string;
  action: 'cancel' | 'fulfill';
  reason: string;
  evidence: string;
}

export interface SystemTruthApplyResult {
  before: SystemTruthSnapshot;
  after: SystemTruthSnapshot;
  applied: SystemTruthApplyAction[];
  skipped: string[];
}

export interface EvaluateSystemTruthOptions {
  memoryDir: string;
  repoRoot?: string;
  middlewareUrl?: string;
  kgUrl?: string;
  now?: Date;
  fetchImpl?: typeof fetch;
  middlewareTaskLimit?: number;
  kgPushSample?: boolean;
}

const ACTIVE_TASK_STATUSES = ['pending', 'in_progress', 'needs-decomposition', 'blocked', 'hold'];
const ACTIVE_COMMITMENT_STATUS = 'active';
const STALE_ACTIVE_MS = 12 * 60 * 60 * 1000;

export async function evaluateSystemTruth(options: EvaluateSystemTruthOptions): Promise<SystemTruthSnapshot> {
  const now = options.now ?? new Date();
  const fetchImpl = options.fetchImpl ?? fetch;
  const repoRoot = options.repoRoot ?? process.cwd();
  const middlewareUrl = trimTrailingSlash(options.middlewareUrl ?? process.env.MIDDLEWARE_URL ?? 'http://localhost:3200');
  const kgUrl = trimTrailingSlash(options.kgUrl ?? process.env.KG_BASE_URL ?? 'http://localhost:3300');

  const localActiveTasks = queryMemoryIndexSync(options.memoryDir, {
    type: ['task'],
    status: ACTIVE_TASK_STATUSES,
  });
  const autonomy = evaluateAutonomyClosure(options.memoryDir, { repoRoot, now });
  const middleware = await readMiddlewareTruth(middlewareUrl, fetchImpl, options.middlewareTaskLimit ?? 200);
  const kg = await readKnowledgeGraphTruth(kgUrl, fetchImpl, options.kgPushSample ?? true);

  const findings: TruthFinding[] = [
    ...localFindings(localActiveTasks, autonomy.status),
    ...middlewareFindings(middleware, now),
    ...kgFindings(kg),
  ];

  const blockerCount = findings.filter(f => f.severity === 'blocker').length;
  const warnCount = findings.filter(f => f.severity === 'warn').length;
  const score = Math.max(0, 100 - blockerCount * 25 - warnCount * 8);
  const status: TruthStatus = blockerCount > 0 ? 'blocked' : warnCount > 0 ? 'degraded' : 'healthy';

  return {
    status,
    generatedAt: now.toISOString(),
    score,
    counts: {
      localActiveTasks: localActiveTasks.length,
      middlewareActiveCommitments: middleware.online ? middleware.activeCommitments.length : null,
      middlewareRunningTasks: middleware.online ? middleware.recentTasks.filter(t => t.status === 'running').length : null,
      middlewareUnreviewedCompletedTasks: middleware.online ? countUnreviewedCompleted(options.memoryDir, middleware.recentTasks) : null,
      kgNodes: typeof kg.health?.nodes === 'number' ? kg.health.nodes : null,
      kgEdges: typeof kg.health?.edges === 'number' ? kg.health.edges : null,
    },
    local: {
      activeTasks: localActiveTasks.slice(0, 50).map(t => ({
        id: t.id,
        status: t.status,
        summary: t.summary,
        ts: t.ts,
        payload: t.payload,
      })),
      autonomyStatus: autonomy.status,
      autonomyScore: autonomy.score,
    },
    middleware,
    kg,
    findings,
  };
}

export async function applySafeSystemTruth(options: EvaluateSystemTruthOptions): Promise<SystemTruthApplyResult> {
  const before = await evaluateSystemTruth({ ...options, kgPushSample: false });
  const middlewareUrl = trimTrailingSlash(options.middlewareUrl ?? process.env.MIDDLEWARE_URL ?? 'http://localhost:3200');
  const fetchImpl = options.fetchImpl ?? fetch;
  const applied: SystemTruthApplyAction[] = [];
  const skipped: string[] = [];

  if (!before.middleware.online) {
    skipped.push(`middleware offline: ${before.middleware.error ?? 'unknown error'}`);
    return { before, after: before, applied, skipped };
  }

  const seen = new Set<string>();
  for (const action of planSafeMiddlewareActions(before)) {
    if (seen.has(action.commitmentId)) continue;
    seen.add(action.commitmentId);
    try {
      await patchCommitment(middlewareUrl, fetchImpl, action);
      applied.push(action);
    } catch (err) {
      skipped.push(`${action.commitmentId}: ${errorMessage(err)}`);
    }
  }

  const after = await evaluateSystemTruth({ ...options, kgPushSample: false });
  return { before, after, applied, skipped };
}

export function formatSystemTruth(snapshot: SystemTruthSnapshot): string {
  const lines: string[] = [];
  lines.push(`system truth: ${snapshot.status} score=${snapshot.score}`);
  lines.push(`generated: ${snapshot.generatedAt}`);
  lines.push(`local active tasks: ${snapshot.counts.localActiveTasks}`);
  lines.push(`middleware active commitments: ${snapshot.counts.middlewareActiveCommitments ?? 'offline'}`);
  lines.push(`middleware running tasks: ${snapshot.counts.middlewareRunningTasks ?? 'offline'}`);
  lines.push(`middleware unreviewed completed: ${snapshot.counts.middlewareUnreviewedCompletedTasks ?? 'offline'}`);
  lines.push(`kg: ${snapshot.kg.online ? `${snapshot.counts.kgNodes ?? '?'} nodes / ${snapshot.counts.kgEdges ?? '?'} edges` : 'offline'}`);
  lines.push('');
  lines.push('findings:');
  if (snapshot.findings.length === 0) {
    lines.push('- info no truth gaps detected');
  } else {
    for (const finding of snapshot.findings) {
      lines.push(`- ${finding.severity} ${finding.kind}: ${finding.summary}`);
      for (const evidence of finding.evidence.slice(0, 5)) lines.push(`  evidence: ${evidence}`);
      if (finding.recommendation) lines.push(`  next: ${finding.recommendation}`);
    }
  }
  return lines.join('\n');
}

export function duplicateActiveCommitments(active: MiddlewareCommitmentTruth[]): Array<{ key: string; items: MiddlewareCommitmentTruth[] }> {
  const groups = new Map<string, MiddlewareCommitmentTruth[]>();
  for (const commitment of active) {
    const key = canonicalCommitmentKey(commitment.text);
    if (!key) continue;
    const group = groups.get(key) ?? [];
    group.push(commitment);
    groups.set(key, group);
  }
  return [...groups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([key, items]) => ({ key, items }));
}

export function planSafeMiddlewareActions(snapshot: SystemTruthSnapshot): SystemTruthApplyAction[] {
  if (!snapshot.middleware.online) return [];
  const actions: SystemTruthApplyAction[] = [];
  const active = snapshot.middleware.activeCommitments;

  for (const group of duplicateActiveCommitments(active)) {
    const sorted = [...group.items].sort(compareCommitmentsNewestFirst);
    const keep = sorted[0];
    for (const duplicate of sorted.slice(1)) {
      actions.push({
        commitmentId: duplicate.id,
        action: 'cancel',
        reason: 'duplicate-active-commitment',
        evidence: `system-truth apply-safe: duplicate active commitment; kept freshest ${keep.id}`,
      });
    }
  }

  const terminalTasks = new Map(
    snapshot.middleware.recentTasks
      .filter(t => ['completed', 'failed', 'cancelled', 'skipped'].includes(t.status))
      .map(t => [t.id, t]),
  );

  for (const commitment of active) {
    if (!commitment.linked_task_id) continue;
    const task = terminalTasks.get(commitment.linked_task_id);
    if (!task) continue;
    actions.push({
      commitmentId: commitment.id,
      action: task.status === 'completed' ? 'fulfill' : 'cancel',
      reason: `linked-task-${task.status}`,
      evidence: `system-truth apply-safe: linked task ${task.id} is ${task.status}`,
    });
  }

  return actions;
}

export function canonicalCommitmentKey(text: string): string {
  return extractTaskTitle(text)
    .toLowerCase()
    .replace(/task id:\s*\S+/g, '')
    .replace(/idx-[a-z0-9-]+/g, '')
    .replace(/#\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

async function readMiddlewareTruth(baseUrl: string, fetchImpl: typeof fetch, taskLimit: number): Promise<SystemTruthSnapshot['middleware']> {
  try {
    const [health, commits, tasks] = await Promise.all([
      fetchJson<Record<string, unknown>>(fetchImpl, `${baseUrl}/health`, 3000),
      fetchJson<{ items?: unknown[] }>(fetchImpl, `${baseUrl}/commits?status=${ACTIVE_COMMITMENT_STATUS}`, 5000),
      fetchJson<{ tasks?: unknown[] }>(fetchImpl, `${baseUrl}/tasks?limit=${taskLimit}`, 5000),
    ]);
    return {
      online: true,
      health,
      activeCommitments: (commits.items ?? []).map(parseCommitment).filter(Boolean) as MiddlewareCommitmentTruth[],
      recentTasks: (tasks.tasks ?? []).map(parseMiddlewareTask).filter(Boolean) as MiddlewareTaskTruth[],
    };
  } catch (err) {
    return {
      online: false,
      activeCommitments: [],
      recentTasks: [],
      error: errorMessage(err),
    };
  }
}

async function readKnowledgeGraphTruth(baseUrl: string, fetchImpl: typeof fetch, includePushSample: boolean): Promise<KnowledgeGraphTruth> {
  const feature = getFeature('kg-retrieval-augment');
  try {
    const [health, stats, push] = await Promise.all([
      fetchJson<Record<string, unknown>>(fetchImpl, `${baseUrl}/health`, 3000),
      fetchJson<Record<string, unknown>>(fetchImpl, `${baseUrl}/api/stats`, 3000).catch(() => ({})),
      includePushSample
        ? fetchJson<{ text?: string }>(fetchImpl, `${baseUrl}/api/push/formatted`, 3000, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            context: 'Kuro mini-agent middleware knowledge graph closure truth reconciliation',
            agent_id: 'kuro',
            limit: 3,
          }),
        }).catch(() => undefined)
        : Promise.resolve(undefined),
    ]);
    const merged = { ...health, ...stats };
    const lastRun = (health.maintenance as { last_run?: { result?: { report?: { quality?: { score?: number } } } } } | undefined)
      ?.last_run?.result?.report?.quality?.score;
    return {
      online: true,
      health: merged,
      maintenanceScore: typeof lastRun === 'number' ? lastRun : undefined,
      retrievalAugmentEnabled: feature?.enabled ?? true,
      pushSample: push?.text,
    };
  } catch (err) {
    return {
      online: false,
      retrievalAugmentEnabled: feature?.enabled ?? true,
      error: errorMessage(err),
    };
  }
}

function localFindings(activeTasks: MemoryIndexEntry[], autonomyStatus: string): TruthFinding[] {
  const findings: TruthFinding[] = [];
  if (activeTasks.length > 10) {
    findings.push({
      severity: 'warn',
      kind: 'local-task-backlog',
      summary: `${activeTasks.length} local active task(s) are visible to scheduler`,
      evidence: activeTasks.slice(0, 5).map(t => `${t.id} ${t.status}: ${(t.summary ?? '').slice(0, 100)}`),
      recommendation: 'Reconcile task-events before creating new autonomous work.',
    });
  }
  if (autonomyStatus === 'blocked') {
    findings.push({
      severity: 'blocker',
      kind: 'closure-health',
      summary: 'autonomy closure reports blocked',
      evidence: ['pnpm check:autonomy-closure -- --json'],
      recommendation: 'Repair the blocking autonomy stage before expanding KG or middleware behavior.',
    });
  }
  return findings;
}

function middlewareFindings(middleware: SystemTruthSnapshot['middleware'], now: Date): TruthFinding[] {
  if (!middleware.online) {
    return [{
      severity: 'blocker',
      kind: 'middleware-offline',
      summary: 'agent-middleware is not reachable',
      evidence: [middleware.error ?? 'unknown error'],
      recommendation: 'Restart middleware before dispatching or reconciling delegate lifecycle.',
    }];
  }

  const findings: TruthFinding[] = [];
  const active = middleware.activeCommitments;
  if (active.length > 10) {
    findings.push({
      severity: 'warn',
      kind: 'middleware-active-backlog',
      summary: `${active.length} active middleware commitment(s) need reconciliation`,
      evidence: active.slice(-5).map(c => `${c.id} ${ageLabel(c.created_at, now)}: ${extractTaskTitle(c.text)}`),
      recommendation: 'Close fulfilled commitments or cancel obsolete ones with explicit evidence.',
    });
  }

  for (const group of duplicateActiveCommitments(active)) {
    findings.push({
      severity: 'warn',
      kind: 'middleware-duplicate-active',
      summary: `${group.items.length} active commitments share the same task shape`,
      evidence: group.items.map(c => `${c.id} ${ageLabel(c.created_at, now)}: ${extractTaskTitle(c.text)}`).slice(0, 6),
      recommendation: 'Keep the freshest real task and cancel stale duplicates.',
    });
  }

  const stale = active.filter(c => now.getTime() - Date.parse(c.created_at) > STALE_ACTIVE_MS);
  if (stale.length > 0) {
    findings.push({
      severity: 'warn',
      kind: 'middleware-stale-active',
      summary: `${stale.length} active middleware commitment(s) are older than 12h`,
      evidence: stale.slice(-8).map(c => `${c.id} ${ageLabel(c.created_at, now)}: ${extractTaskTitle(c.text)}`),
      recommendation: 'Resolve, supersede, or cancel aged active commitments; do not let them re-enter Kuro context as live work.',
    });
  }
  return findings;
}

function kgFindings(kg: KnowledgeGraphTruth): TruthFinding[] {
  if (!kg.online) {
    return [{
      severity: 'warn',
      kind: 'kg-offline',
      summary: 'knowledge-graph service is not reachable',
      evidence: [kg.error ?? 'unknown error'],
      recommendation: 'Restore KG before relying on shared-memory claims.',
    }];
  }
  const findings: TruthFinding[] = [];
  if (!kg.retrievalAugmentEnabled) {
    findings.push({
      severity: 'warn',
      kind: 'kg-retrieval-disabled',
      summary: 'mini-agent KG retrieval augmentation is disabled',
      evidence: ['feature=kg-retrieval-augment enabled=false'],
      recommendation: 'Fix retrieval quality gates, then re-enable augmentation so KG affects Kuro decisions.',
    });
  }
  if (kg.pushSample && likelyLowSignalPush(kg.pushSample)) {
    findings.push({
      severity: 'warn',
      kind: 'kg-push-low-signal',
      summary: 'KG push sample contains low-signal raw observations',
      evidence: kg.pushSample.split('\n').filter(line => line.trim().startsWith('- **')).slice(0, 3),
      recommendation: 'Down-rank raw observation nodes and prefer canonical/decision/principle nodes for context injection.',
    });
  }
  return findings;
}

function extractTaskTitle(text: string): string {
  const taskMatch = text.match(/## Task:\s*([^\n]+)/);
  if (taskMatch?.[1]) return taskMatch[1].trim();
  const first = text.split('\n').map(l => l.trim()).find(Boolean);
  return first ?? '';
}

function countUnreviewedCompleted(memoryDir: string, tasks: MiddlewareTaskTruth[]): number {
  const completed = tasks.filter(t => t.status === 'completed');
  if (completed.length === 0) return 0;
  const reviewedText = readReviewedDelegationText(memoryDir);
  return completed.filter(t => !reviewedText.includes(t.id)).length;
}

function readReviewedDelegationText(memoryDir: string): string {
  const candidates = [
    path.join(memoryDir, 'state', 'task-closures.jsonl'),
    path.join(memoryDir, 'state', 'work-journal.jsonl'),
    path.join(memoryDir, 'state', 'activity-journal.jsonl'),
  ];
  return candidates
    .filter(existsSync)
    .map(p => {
      try { return readFileSync(p, 'utf-8'); } catch { return ''; }
    })
    .join('\n');
}

function likelyLowSignalPush(text: string): boolean {
  const rawSignals = ['kuro:', 'claude-code:', '收到。', '</recent_conversations>', '請求關閉討論'];
  const hits = rawSignals.filter(signal => text.includes(signal)).length;
  return hits >= 2 || /type="observation"| \[observation\]/i.test(text);
}

function parseCommitment(value: unknown): MiddlewareCommitmentTruth | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.status !== 'string' || typeof record.text !== 'string') return null;
  return {
    id: record.id,
    status: record.status,
    owner: typeof record.owner === 'string' ? record.owner : undefined,
    created_at: typeof record.created_at === 'string' ? record.created_at : '',
    text: record.text,
    linked_task_id: typeof record.linked_task_id === 'string' ? record.linked_task_id : undefined,
  };
}

function parseMiddlewareTask(value: unknown): MiddlewareTaskTruth | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || typeof record.worker !== 'string' || typeof record.status !== 'string') return null;
  return {
    id: record.id,
    worker: record.worker,
    status: record.status,
    durationMs: typeof record.durationMs === 'number' ? record.durationMs : undefined,
    startedAt: typeof record.startedAt === 'string' ? record.startedAt : undefined,
    completedAt: typeof record.completedAt === 'string' ? record.completedAt : undefined,
    task: typeof record.task === 'string' ? record.task : '',
  };
}

async function patchCommitment(baseUrl: string, fetchImpl: typeof fetch, action: SystemTruthApplyAction): Promise<void> {
  const status = action.action === 'fulfill' ? 'fulfilled' : 'cancelled';
  const kind = action.action === 'fulfill' ? 'task-close' : 'cancel';
  await fetchJson(fetchImpl, `${baseUrl}/commit/${encodeURIComponent(action.commitmentId)}`, 5000, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      status,
      resolution: { kind, evidence: action.evidence },
    }),
  });
}

async function fetchJson<T>(fetchImpl: typeof fetch, url: string, timeoutMs: number, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
    return await res.json() as T;
  } finally {
    clearTimeout(timer);
  }
}

function ageLabel(ts: string, now: Date): string {
  const ms = now.getTime() - Date.parse(ts);
  if (!Number.isFinite(ms)) return 'age=unknown';
  const hours = Math.max(0, ms / 3_600_000);
  return hours < 48 ? `${hours.toFixed(1)}h` : `${(hours / 24).toFixed(1)}d`;
}

function compareCommitmentsNewestFirst(a: MiddlewareCommitmentTruth, b: MiddlewareCommitmentTruth): number {
  return Date.parse(b.created_at) - Date.parse(a.created_at);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
