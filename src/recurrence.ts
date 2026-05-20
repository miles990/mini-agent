/**
 * Recurrence — recurring work as first-class scheduler tasks.
 *
 * Replaces the standalone cron subsystem (former src/cron.ts). Instead of a
 * parallel node-cron queue that bypassed the scheduler, a recurring job is a
 * normal memory-index task carrying `payload.recurrence` (a cron expression).
 *
 * Lifecycle (fully owned by the scheduler):
 *   hold (holdCondition=date-after nextFire)
 *     → checkHoldTasks unblocks when now >= nextFire → pending
 *     → scheduler picks it → in_progress → completed
 *     → rearmRecurringTasks computes the next fire time → back to hold
 *
 * Granularity floor: recurring tasks can only fire as often as the OODA cycle
 * runs (~20m in prod), since hold checks happen per cycle. Sub-cycle cron
 * expressions are accepted but will not fire more often than one cycle.
 */

import { CronExpressionParser } from 'cron-parser';
import {
  appendMemoryIndexEntry,
  updateMemoryIndexEntry,
  queryMemoryIndexSync,
  type MemoryIndexEntry,
} from './memory-index.js';
import { slog } from './utils.js';

// Interpret cron expressions in the machine's local timezone (matches the
// behaviour of the former node-cron subsystem).
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

// Default priority for recurrence-origin tasks (scheduler computeScore: P2 = normal).
const RECURRING_PRIORITY = 2;

export interface RecurringSeed {
  /** Cron expression, e.g. "0 10 * * 0". */
  schedule: string;
  /** Natural-language task text — also the stable identity key. */
  task: string;
  /** When false, the seed is skipped and any existing task abandoned. */
  enabled?: boolean;
}

export interface RecurringSyncResult {
  created: number;
  updated: number;
  removed: number;
  unchanged: number;
}

// =============================================================================
// Cron expression helpers
// =============================================================================

/** Compute the next fire time strictly after `from` (default: now). Throws on bad input. */
export function nextFireTime(expr: string, from: Date = new Date()): Date {
  const it = CronExpressionParser.parse(expr, { currentDate: from, tz: LOCAL_TZ });
  return it.next().toDate();
}

/** True when `expr` is a parseable cron expression. */
export function isValidRecurrence(expr: string): boolean {
  if (!expr || !expr.trim()) return false;
  try {
    CronExpressionParser.parse(expr, { tz: LOCAL_TZ });
    return true;
  } catch {
    return false;
  }
}

// =============================================================================
// Recurring task queries
// =============================================================================

function isRecurring(entry: MemoryIndexEntry): boolean {
  const recurrence = (entry.payload as Record<string, unknown> | undefined)?.recurrence;
  return typeof recurrence === 'string' && recurrence.length > 0;
}

/** All live (non-abandoned, non-deleted) recurring tasks. */
export function listRecurringTasks(memoryDir: string): MemoryIndexEntry[] {
  return queryMemoryIndexSync(memoryDir, { type: 'task' })
    .filter(isRecurring)
    .filter(e => e.status !== 'abandoned' && e.status !== 'deleted');
}

export function getRecurringTaskCount(memoryDir: string): number {
  return listRecurringTasks(memoryDir).length;
}

// =============================================================================
// Create / sync
// =============================================================================

function buildRecurringPayload(seed: RecurringSeed, nextFire: Date): Record<string, unknown> {
  return {
    recurrence: seed.schedule,
    recurrenceKey: seed.task,
    source: 'system',
    priority: RECURRING_PRIORITY,
    holdCondition: { type: 'date-after', value: nextFire.toISOString() },
  };
}

async function createRecurringTask(
  memoryDir: string,
  seed: RecurringSeed,
): Promise<MemoryIndexEntry> {
  const nextFire = nextFireTime(seed.schedule);
  return appendMemoryIndexEntry(memoryDir, {
    type: 'task',
    status: 'hold',
    source: 'system',
    summary: seed.task,
    payload: buildRecurringPayload(seed, nextFire),
  });
}

/**
 * Reconcile recurring tasks against a set of seeds (from agent-compose.yaml).
 * Used at startup and on compose hot-reload:
 *  - missing seed     → create a held recurring task
 *  - changed schedule → update the recurrence expression
 *  - removed/disabled → abandon the recurring task
 */
export async function syncRecurringTasks(
  memoryDir: string,
  seeds: RecurringSeed[],
): Promise<RecurringSyncResult> {
  const result: RecurringSyncResult = { created: 0, updated: 0, removed: 0, unchanged: 0 };

  const enabled = seeds.filter(s => s.enabled !== false && isValidRecurrence(s.schedule));
  for (const s of seeds) {
    if (s.enabled !== false && !isValidRecurrence(s.schedule)) {
      slog('RECUR', `skip invalid schedule "${s.schedule}" for: ${s.task.slice(0, 50)}`);
    }
  }
  const enabledKeys = new Set(enabled.map(s => s.task));
  const existing = listRecurringTasks(memoryDir);
  const byKey = new Map<string, MemoryIndexEntry>();
  for (const e of existing) {
    const key = (e.payload as Record<string, unknown>).recurrenceKey;
    if (typeof key === 'string') byKey.set(key, e);
  }

  // Create / update
  for (const seed of enabled) {
    const match = byKey.get(seed.task);
    if (!match) {
      await createRecurringTask(memoryDir, seed);
      result.created++;
      continue;
    }
    const payload = { ...(match.payload as Record<string, unknown>) };
    if (payload.recurrence === seed.schedule) {
      result.unchanged++;
      continue;
    }
    payload.recurrence = seed.schedule;
    // Only re-arm the hold timer if the task is currently waiting; a running
    // task keeps its state and picks up the new schedule on next completion.
    if (match.status === 'hold') {
      payload.holdCondition = {
        type: 'date-after',
        value: nextFireTime(seed.schedule).toISOString(),
      };
    }
    await updateMemoryIndexEntry(memoryDir, match.id, { payload });
    result.updated++;
  }

  // Abandon tasks whose seed is gone or disabled
  for (const entry of existing) {
    const key = (entry.payload as Record<string, unknown>).recurrenceKey;
    if (typeof key === 'string' && !enabledKeys.has(key)) {
      await updateMemoryIndexEntry(memoryDir, entry.id, { status: 'abandoned' });
      result.removed++;
    }
  }

  if (result.created || result.updated || result.removed) {
    slog('RECUR', `sync: +${result.created} ~${result.updated} -${result.removed} =${result.unchanged}`);
  }
  return result;
}

// =============================================================================
// Re-arm — called by the scheduler each tick
// =============================================================================

/**
 * Find completed recurring tasks and re-arm them: compute the next fire time
 * and move them back to `hold` with a fresh date-after condition. This is the
 * symmetric counterpart to scheduler.checkHoldTasks (which unblocks holds).
 */
export async function rearmRecurringTasks(memoryDir: string): Promise<{ rearmed: string[] }> {
  const completed = queryMemoryIndexSync(memoryDir, { type: 'task', status: 'completed' })
    .filter(isRecurring);

  const rearmed: string[] = [];
  for (const entry of completed) {
    const payload = { ...(entry.payload as Record<string, unknown>) };
    const expr = payload.recurrence as string;
    if (!isValidRecurrence(expr)) {
      slog('RECUR', `cannot re-arm ${entry.id}: invalid recurrence "${expr}"`);
      continue;
    }
    payload.holdCondition = {
      type: 'date-after',
      value: nextFireTime(expr).toISOString(),
    };
    await updateMemoryIndexEntry(memoryDir, entry.id, { status: 'hold', payload });
    rearmed.push(entry.id);
  }

  if (rearmed.length > 0) {
    slog('RECUR', `re-armed ${rearmed.length} recurring task(s)`);
  }
  return { rearmed };
}

// =============================================================================
// CRUD — used by the HTTP API
// =============================================================================

export async function addRecurringTask(
  memoryDir: string,
  seed: RecurringSeed,
): Promise<{ success: boolean; error?: string }> {
  if (seed.enabled === false) return { success: false, error: 'Seed is disabled' };
  if (!isValidRecurrence(seed.schedule)) {
    return { success: false, error: `Invalid schedule: ${seed.schedule}` };
  }
  if (!seed.task || seed.task.trim().length < 5) {
    return { success: false, error: 'Task text too short' };
  }
  const exists = listRecurringTasks(memoryDir).some(
    e => (e.payload as Record<string, unknown>).recurrenceKey === seed.task,
  );
  if (exists) return { success: false, error: 'Recurring task already exists' };

  await createRecurringTask(memoryDir, seed);
  return { success: true };
}

export async function removeRecurringTask(
  memoryDir: string,
  taskKey: string,
): Promise<{ success: boolean; error?: string }> {
  const match = listRecurringTasks(memoryDir).find(
    e => (e.payload as Record<string, unknown>).recurrenceKey === taskKey,
  );
  if (!match) return { success: false, error: 'Recurring task not found' };

  await updateMemoryIndexEntry(memoryDir, match.id, { status: 'abandoned' });
  return { success: true };
}
