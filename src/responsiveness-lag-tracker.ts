/**
 * responsiveness-lag-tracker.ts
 *
 * Tracks consecutive `low-responsiveness` correction-gate emissions per task ID.
 * Implements option (c) from GitHub issue #124: if the same taskId drives
 * low-responsiveness for ≥ SIGNAL_LAG_THRESHOLD consecutive emissions without
 * a task-events write between them, suppress re-emit and emit a one-shot
 * `signal-lag` warning instead.
 *
 * State is persisted in `memory/state/responsiveness-lag.json` so it survives
 * restarts and is visible to debugging tools.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const SIGNAL_LAG_THRESHOLD = 3;

const LAG_STATE_FILE = 'state/responsiveness-lag.json';

export interface LagTrackerState {
  /** The taskId currently accumulating consecutive emissions. */
  currentTaskId: string | null;
  /** How many consecutive cycles this taskId has been named as stalest. */
  consecutiveCount: number;
  /** ISO timestamp of the last recorded emission. */
  lastEmittedAt: string | null;
  /** Set of taskIds already suppressed (to avoid re-logging every cycle). */
  suppressedTaskIds: string[];
}

function lagFilePath(memoryDir: string): string {
  return path.join(memoryDir, LAG_STATE_FILE);
}

function loadState(memoryDir: string): LagTrackerState {
  const file = lagFilePath(memoryDir);
  if (!existsSync(file)) {
    return { currentTaskId: null, consecutiveCount: 0, lastEmittedAt: null, suppressedTaskIds: [] };
  }
  try {
    const raw = readFileSync(file, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<LagTrackerState>;
    return {
      currentTaskId: parsed.currentTaskId ?? null,
      consecutiveCount: typeof parsed.consecutiveCount === 'number' ? parsed.consecutiveCount : 0,
      lastEmittedAt: parsed.lastEmittedAt ?? null,
      suppressedTaskIds: Array.isArray(parsed.suppressedTaskIds) ? parsed.suppressedTaskIds : [],
    };
  } catch {
    return { currentTaskId: null, consecutiveCount: 0, lastEmittedAt: null, suppressedTaskIds: [] };
  }
}

function saveState(memoryDir: string, state: LagTrackerState): void {
  const file = lagFilePath(memoryDir);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2), 'utf-8');
}

/**
 * Record that `taskId` was just named as the stalest task in a
 * low-responsiveness emission. Increments consecutive count if the same
 * task fires again; resets if a different task is named.
 *
 * Returns the updated consecutive count for the given taskId.
 */
export function recordLowResponsivenessEmission(memoryDir: string, taskId: string): number {
  const state = loadState(memoryDir);

  if (state.currentTaskId === taskId) {
    state.consecutiveCount += 1;
  } else {
    // Different task is now named stalest — reset.
    state.currentTaskId = taskId;
    state.consecutiveCount = 1;
    // Remove the previous task from suppressed list (it's no longer the named stalest).
  }
  state.lastEmittedAt = new Date().toISOString();

  saveState(memoryDir, state);
  return state.consecutiveCount;
}

/**
 * Returns the number of consecutive cycles `taskId` has been named as
 * stalest in low-responsiveness emissions. Returns 0 if it's not the
 * current accumulating task.
 */
export function getConsecutiveEmissionCount(memoryDir: string, taskId: string): number {
  const state = loadState(memoryDir);
  if (state.currentTaskId !== taskId) return 0;
  return state.consecutiveCount;
}

/**
 * Mark a taskId as suppressed (signal-lag confirmed). Prevents further
 * low-responsiveness emissions for this task until reset.
 */
export function markTaskSuppressed(memoryDir: string, taskId: string): void {
  const state = loadState(memoryDir);
  if (!state.suppressedTaskIds.includes(taskId)) {
    state.suppressedTaskIds.push(taskId);
  }
  saveState(memoryDir, state);
}

/**
 * Returns true if a taskId has been suppressed due to signal-lag.
 */
export function isTaskSuppressed(memoryDir: string, taskId: string): boolean {
  const state = loadState(memoryDir);
  return state.suppressedTaskIds.includes(taskId);
}

/**
 * Reset lag tracking for a specific taskId. Called when the task receives a
 * real progress event (e.g. task-events write, status change, explicit close).
 */
export function resetLagTracker(memoryDir: string, taskId: string): void {
  const state = loadState(memoryDir);
  if (state.currentTaskId === taskId) {
    state.currentTaskId = null;
    state.consecutiveCount = 0;
  }
  state.suppressedTaskIds = state.suppressedTaskIds.filter(id => id !== taskId);
  saveState(memoryDir, state);
}
