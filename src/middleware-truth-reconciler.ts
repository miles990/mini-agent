import { type Commitment, type CommitmentStatus, type TaskStatusValue } from './middleware-client.js';
import { slog } from './utils.js';

export interface MiddlewareTaskSnapshot {
  id: string;
  status: TaskStatusValue;
}

export type MiddlewareCommitmentTruthAction =
  | {
      type: 'fulfill';
      id: string;
      reason: 'linked-task-completed';
      evidence: string;
    }
  | {
      type: 'cancel';
      id: string;
      reason: 'linked-task-terminal' | 'duplicate-active-commitment';
      evidence: string;
    };

export interface MiddlewareCommitmentReconcileSummary {
  planned: number;
  applied: number;
  skipped: number;
}

interface ReconcileOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  dryRun?: boolean;
}

type CommitmentPatchBody = {
  status: CommitmentStatus;
  resolution: {
    kind: 'task-close' | 'cancel';
    evidence: string;
    note?: string;
  };
};

const TERMINAL_FAILED_STATUSES = new Set<TaskStatusValue>(['failed', 'cancelled', 'skipped']);

export function canonicalMiddlewareCommitmentKey(commitment: Pick<Commitment, 'text' | 'acceptance'>): string {
  return `${normalizeCommitmentText(commitment.text)}\nacceptance:${normalizeCommitmentText(commitment.acceptance)}`;
}

function normalizeCommitmentText(text: string): string {
  return text
    .replace(/Task ID:\s*\S+/gi, 'Task ID:<id>')
    .replace(/\b(task|auto|idx|cmt)-[a-z0-9_-]{8,}\b/gi, '<id>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function planMiddlewareCommitmentTruthActions(
  commitments: Commitment[],
  tasks: MiddlewareTaskSnapshot[],
): MiddlewareCommitmentTruthAction[] {
  const active = commitments.filter(c => c.status === 'active');
  const taskById = new Map(tasks.map(t => [t.id, t]));
  const actions: MiddlewareCommitmentTruthAction[] = [];
  const acted = new Set<string>();

  for (const commitment of active) {
    if (!commitment.linked_task_id) continue;
    const task = taskById.get(commitment.linked_task_id);
    if (!task) continue;

    if (task.status === 'completed') {
      actions.push({
        type: 'fulfill',
        id: commitment.id,
        reason: 'linked-task-completed',
        evidence: `middleware task ${task.id} completed`,
      });
      acted.add(commitment.id);
      continue;
    }

    if (TERMINAL_FAILED_STATUSES.has(task.status)) {
      actions.push({
        type: 'cancel',
        id: commitment.id,
        reason: 'linked-task-terminal',
        evidence: `middleware task ${task.id} ${task.status}`,
      });
      acted.add(commitment.id);
    }
  }

  const byCanonicalKey = new Map<string, Commitment[]>();
  for (const commitment of active) {
    if (acted.has(commitment.id)) continue;
    const key = canonicalMiddlewareCommitmentKey(commitment);
    const group = byCanonicalKey.get(key) ?? [];
    group.push(commitment);
    byCanonicalKey.set(key, group);
  }

  for (const group of byCanonicalKey.values()) {
    if (group.length <= 1) continue;
    const sorted = [...group].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    const keep = sorted[0];
    for (const duplicate of sorted.slice(1)) {
      actions.push({
        type: 'cancel',
        id: duplicate.id,
        reason: 'duplicate-active-commitment',
        evidence: `duplicate active commitment; kept newest ${keep.id}`,
      });
      acted.add(duplicate.id);
    }
  }

  return actions;
}

export async function reconcileMiddlewareCommitmentsSafe(
  options: ReconcileOptions = {},
): Promise<MiddlewareCommitmentReconcileSummary> {
  const baseUrl = options.baseUrl ?? process.env.MIDDLEWARE_URL ?? 'http://localhost:3200';
  const fetchImpl = options.fetchImpl ?? fetch;
  void options.requestTimeoutMs;

  const [commitments, tasks] = await Promise.all([
    listMiddlewareCommitments(baseUrl, fetchImpl),
    listMiddlewareTasks(baseUrl, fetchImpl),
  ]);

  const actions = planMiddlewareCommitmentTruthActions(commitments, tasks);
  if (actions.length === 0) return { planned: 0, applied: 0, skipped: 0 };

  if (options.dryRun) {
    slog('MIDDLEWARE-TRUTH', `dry-run planned ${actions.length} commitment reconciliation action(s)`);
    return { planned: actions.length, applied: 0, skipped: actions.length };
  }

  let applied = 0;
  for (const action of actions) {
    try {
      await patchCommitment(baseUrl, action, fetchImpl);
      applied++;
    } catch (err) {
      slog('MIDDLEWARE-TRUTH', `failed to ${action.type} ${action.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (applied > 0) {
    slog('MIDDLEWARE-TRUTH', `applied ${applied}/${actions.length} commitment reconciliation action(s)`);
  }

  return { planned: actions.length, applied, skipped: actions.length - applied };
}

async function listMiddlewareCommitments(baseUrl: string, fetchImpl: typeof fetch): Promise<Commitment[]> {
  const res = await fetchImpl(`${baseUrl}/commits?status=active`);
  if (!res.ok) throw new Error(`GET /commits failed: HTTP ${res.status}`);
  return await res.json() as Commitment[];
}

async function listMiddlewareTasks(baseUrl: string, fetchImpl: typeof fetch): Promise<MiddlewareTaskSnapshot[]> {
  const res = await fetchImpl(`${baseUrl}/tasks?limit=200`);
  if (!res.ok) throw new Error(`GET /tasks failed: HTTP ${res.status}`);
  const payload = await res.json() as { tasks?: MiddlewareTaskSnapshot[] } | MiddlewareTaskSnapshot[];
  return Array.isArray(payload) ? payload : payload.tasks ?? [];
}

async function patchCommitment(
  baseUrl: string,
  action: MiddlewareCommitmentTruthAction,
  fetchImpl: typeof fetch,
): Promise<void> {
  const body: CommitmentPatchBody = action.type === 'fulfill'
    ? {
        status: 'fulfilled',
        resolution: {
          kind: 'task-close',
          evidence: action.evidence,
          note: action.reason,
        },
      }
    : {
        status: 'cancelled',
        resolution: {
          kind: 'cancel',
          evidence: action.evidence,
          note: action.reason,
        },
      };

  const res = await fetchImpl(`${baseUrl}/commit/${encodeURIComponent(action.id)}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH /commit/${action.id} failed: HTTP ${res.status}`);
}
