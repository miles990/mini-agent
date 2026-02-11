/**
 * Lightweight Cron — Minimal Core Enhanced
 *
 * Simple cron scheduler without node-cron dependency.
 * Supports: "* /N * * * *" (every N minutes), fixed hour/minute patterns.
 * Checks every 60 seconds.
 */

import { behaviorLog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

interface CronTask {
  name: string;
  pattern: string;
  fn: () => Promise<void>;
  lastRun: number;
}

// =============================================================================
// Cron Engine
// =============================================================================

const tasks: CronTask[] = [];
let tickTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Register a cron task.
 * Supported patterns:
 *   "every Nm"  — every N minutes (e.g. "every 30m")
 *   "every Nh"  — every N hours
 *   "HH:MM"     — daily at specific time
 */
export function schedule(name: string, pattern: string, fn: () => Promise<void>): void {
  tasks.push({ name, pattern, fn, lastRun: 0 });
}

export function startCron(): void {
  if (tickTimer) return;
  tickTimer = setInterval(() => tick(), 60_000);
  // Run first tick after 5 seconds (let system initialize)
  setTimeout(() => tick(), 5000);
}

export function stopCron(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

export function getCronTaskCount(): number {
  return tasks.length;
}

// =============================================================================
// Tick — check all tasks
// =============================================================================

async function tick(): Promise<void> {
  const now = new Date();
  const nowMs = now.getTime();

  for (const task of tasks) {
    if (shouldRun(task, now, nowMs)) {
      task.lastRun = nowMs;
      try {
        await task.fn();
        behaviorLog('cron.trigger', task.name);
      } catch (err) {
        console.error(`[CRON] Error in ${task.name}:`, err);
      }
    }
  }
}

function shouldRun(task: CronTask, now: Date, nowMs: number): boolean {
  const { pattern, lastRun } = task;

  // "every Nm" or "every Nh"
  const everyMatch = pattern.match(/^every\s+(\d+)(m|h)$/);
  if (everyMatch) {
    const value = parseInt(everyMatch[1], 10);
    const intervalMs = everyMatch[2] === 'h' ? value * 3_600_000 : value * 60_000;
    return (nowMs - lastRun) >= intervalMs;
  }

  // "HH:MM" — daily at specific time
  const timeMatch = pattern.match(/^(\d{1,2}):(\d{2})$/);
  if (timeMatch) {
    const targetH = parseInt(timeMatch[1], 10);
    const targetM = parseInt(timeMatch[2], 10);
    if (now.getHours() === targetH && now.getMinutes() === targetM) {
      // Only run once per minute window
      return (nowMs - lastRun) > 90_000;
    }
    return false;
  }

  return false;
}
