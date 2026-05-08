import type { MemoryIndexEntry } from './memory-index.js';
import type { IncomingEvent, SchedulingDecision } from './scheduler.js';

export type ConfirmedHoldKind =
  | 'waiting-user'
  | 'waiting-review'
  | 'waiting-external'
  | 'already-observed'
  | 'resolved-upstream';

export interface ConfirmedHoldSignal {
  kind: ConfirmedHoldKind;
  reason: string;
}

export interface ObservationEfficiencyInput {
  decision: SchedulingDecision;
  currentTask?: MemoryIndexEntry;
  allTasks: MemoryIndexEntry[];
  events: IncomingEvent[];
  lastAction?: string | null;
  hasPendingForegroundDelegations: boolean;
  now?: Date;
}

export interface ObservationEfficiencyDecision {
  action: 'reason' | 'hold-and-reallocate';
  reason: string;
  signal?: ConfirmedHoldSignal;
  recheckAt?: string;
}

const ROUTINE_TRIGGER_SOURCES = new Set([
  'heartbeat',
  'continuation',
  'delegation-complete',
  'delegation-batch',
  'startup',
  'workspace',
]);

const DIRECT_TRIGGER_SOURCES = new Set([
  'telegram',
  'room',
  'chat',
  'direct-message',
]);

export function detectConfirmedHoldSignal(text: string | null | undefined): ConfirmedHoldSignal | undefined {
  const raw = text ?? '';
  const body = raw.toLowerCase();
  if (!body.trim()) return undefined;

  if (/(awaiting|waiting for|wait for).{0,80}(alex|user|human|approval|confirmation|ui review|review)/i.test(raw)) {
    return { kind: 'waiting-user', reason: 'previous cycle explicitly waited on user/review input' };
  }

  if (/(awaiting|waiting for|wait for).{0,80}(pr review|reviewer|github review|ci|checks?)/i.test(raw)) {
    return { kind: 'waiting-review', reason: 'previous cycle explicitly waited on review or CI' };
  }

  if (/(blocked by|external blocker|upstream|third[- ]party|rate limit|deploy lock|another deploy)/i.test(raw)) {
    return { kind: 'waiting-external', reason: 'previous cycle identified an external blocker' };
  }

  if (/(already observed|no material change|same state|unchanged|nothing changed|recheck later)/i.test(raw)) {
    return { kind: 'already-observed', reason: 'previous cycle found no material state change' };
  }

  if (/(merged|closed|resolved|fixed upstream|no longer reproducible)/i.test(raw) && /(upstream|pr|issue|github)/i.test(raw)) {
    return { kind: 'resolved-upstream', reason: 'previous cycle says upstream state is already terminal' };
  }

  return undefined;
}

export function shouldUseCodeProbeForObservation(input: ObservationEfficiencyInput): ObservationEfficiencyDecision {
  const { decision, currentTask, events, lastAction, hasPendingForegroundDelegations } = input;
  if (!decision.taskId || !currentTask) {
    return { action: 'reason', reason: 'no bound scheduler task' };
  }

  if (hasPendingForegroundDelegations) {
    return { action: 'reason', reason: 'foreground delegation output may need absorption' };
  }

  const direct = events.some(e => e.isAlexDirectMessage || DIRECT_TRIGGER_SOURCES.has(e.source));
  if (direct) {
    return { action: 'reason', reason: 'direct user trigger deserves reasoning budget' };
  }

  const routine = events.length === 0 || events.some(e => ROUTINE_TRIGGER_SOURCES.has(e.source));
  if (!routine) {
    return { action: 'reason', reason: 'non-routine trigger' };
  }

  const signal = detectConfirmedHoldSignal(`${lastAction ?? ''}\n${currentTask.summary ?? ''}`);
  if (!signal) {
    return { action: 'reason', reason: 'no confirmed hold signal' };
  }

  const currentPriority = readPriority(currentTask);
  const hasOtherUrgentWork = input.allTasks.some(task =>
    task.id !== currentTask.id &&
    ['pending', 'in_progress', 'needs-decomposition'].includes(task.status) &&
    readPriority(task) <= 1
  );
  if (hasOtherUrgentWork && currentPriority > 1) {
    return { action: 'reason', reason: 'other urgent work should be ranked by scheduler first' };
  }

  const now = input.now ?? new Date();
  const holdMs = signal.kind === 'waiting-user' || signal.kind === 'waiting-review'
    ? 2 * 60 * 60_000
    : signal.kind === 'already-observed'
      ? 30 * 60_000
      : 60 * 60_000;

  return {
    action: 'hold-and-reallocate',
    reason: `${signal.reason}; park with deterministic recheck and reallocate LLM budget`,
    signal,
    recheckAt: new Date(now.getTime() + holdMs).toISOString(),
  };
}

export function buildObservationHoldPayload(
  entry: MemoryIndexEntry,
  decision: ObservationEfficiencyDecision,
): Record<string, unknown> {
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  return {
    ...payload,
    observation_efficiency_hold: {
      kind: decision.signal?.kind,
      reason: decision.reason,
      parkedAt: new Date().toISOString(),
      policy: 'Do not spend LLM cycles re-observing confirmed holds; reallocate the same token budget to unblocked work.',
    },
    holdCondition: {
      type: 'date-after',
      value: decision.recheckAt,
    },
  };
}

function readPriority(entry: MemoryIndexEntry): number {
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  const priority = Number(payload.priority);
  return Number.isFinite(priority) ? priority : 3;
}
