/**
 * Agent OS Reactive Policies — self-protection for the scheduler
 *
 * Three policies run on every scheduler tick:
 * 1. Starvation auto-boost: waiting too long → priority upgrade
 * 2. Zombie reaping: running but forgotten → abandon
 * 3. Hung cycle gate: current cycle too slow → warning/terminate
 */

import { slog } from './utils.js';
import { eventBus } from './event-bus.js';
import { type ProcessEntry, transitionProcess, getByState, getProcessTableSnapshot } from './process-table.js';
import { getSchedulerState } from './scheduler.js';

// =============================================================================
// Config
// =============================================================================

const STARVATION_MS = 30 * 60 * 1000;       // 30 min wall time
const STARVATION_BOOST_TTL_TICKS = 20;       // reset boost if not executed within 20 ticks
const ZOMBIE_TICKS = 50;                      // running >50 ticks without being current → zombie
const HUNG_WARNING_MS = 300_000;              // 5 min cycle → warning
const HUNG_TERMINATE_MS = 600_000;            // 10 min cycle → terminate flag

// =============================================================================
// Types
// =============================================================================

export interface ReactiveCheckResult {
  starvedTasks: Array<{ taskId: string; waitMs: number; boosted: boolean }>;
  zombieProcesses: Array<{ taskId: string; reaped: boolean }>;
  hungCycle: { detected: boolean; durationMs: number; action: 'none' | 'warning' | 'terminate' } | null;
}

interface BoostRecord {
  originalPriority: number;
  boostedAt: number;
  tickAtBoost: number;
}

// =============================================================================
// State
// =============================================================================

const boostRecords = new Map<string, BoostRecord>();

// =============================================================================
// Main
// =============================================================================

export function onSchedulerTick(cycleStartTime: number | null): ReactiveCheckResult {
  const result: ReactiveCheckResult = {
    starvedTasks: [],
    zombieProcesses: [],
    hungCycle: null,
  };

  const currentTaskId = getSchedulerState().currentTaskId;
  const currentTick = getSchedulerState().totalTicks;

  // --- Starvation ---
  const waitingProcesses = [
    ...getByState('pending'),
    ...getByState('scheduled'),
    ...getByState('suspended'),
  ];

  const now = Date.now();
  for (const proc of waitingProcesses) {
    const waitMs = now - new Date(proc.lastActiveAt).getTime();

    // Decay: if boosted but not executed within TTL, reset
    const boost = boostRecords.get(proc.taskId);
    if (boost && (currentTick - boost.tickAtBoost) > STARVATION_BOOST_TTL_TICKS) {
      proc.priority = boost.originalPriority;
      boostRecords.delete(proc.taskId);
      slog('REACTIVE', `starvation boost expired for ${proc.taskId.slice(0, 12)}, reset to P${boost.originalPriority}`);
    }

    if (waitMs > STARVATION_MS && proc.priority > 0 && !boostRecords.has(proc.taskId)) {
      const originalPriority = proc.priority;
      proc.priority = Math.max(0, proc.priority - 1);
      boostRecords.set(proc.taskId, {
        originalPriority,
        boostedAt: now,
        tickAtBoost: currentTick,
      });
      slog('REACTIVE', `starvation boost: ${proc.taskId.slice(0, 12)} P${originalPriority}→P${proc.priority} (waited ${Math.round(waitMs / 60000)}min)`);
      eventBus.emit('action:scheduler', { event: 'starvation-boost', taskId: proc.taskId, from: originalPriority, to: proc.priority, waitMs });
      result.starvedTasks.push({ taskId: proc.taskId, waitMs, boosted: true });
    } else if (waitMs > STARVATION_MS) {
      result.starvedTasks.push({ taskId: proc.taskId, waitMs, boosted: false });
    }
  }

  // --- Zombie reaping ---
  const runningProcesses = getByState('running');
  for (const proc of runningProcesses) {
    if (proc.taskId === currentTaskId) continue;
    if (proc.ticksSpent > ZOMBIE_TICKS) {
      const reaped = transitionProcess(proc.taskId, 'abandoned', `zombie: ${proc.ticksSpent} ticks running but not current scheduler task`);
      if (reaped) {
        slog('REACTIVE', `zombie reaped: ${proc.taskId.slice(0, 12)} (${proc.ticksSpent} ticks)`);
        eventBus.emit('action:process', { event: 'zombie-reaped', taskId: proc.taskId, ticksSpent: proc.ticksSpent });
      }
      result.zombieProcesses.push({ taskId: proc.taskId, reaped });
    }
  }

  // --- Hung cycle gate ---
  if (cycleStartTime) {
    const durationMs = now - cycleStartTime;
    if (durationMs > HUNG_TERMINATE_MS) {
      result.hungCycle = { detected: true, durationMs, action: 'terminate' };
      slog('REACTIVE', `HUNG CYCLE: ${Math.round(durationMs / 1000)}s — terminate flag set`);
      eventBus.emit('action:scheduler', { event: 'hung-cycle', durationMs, action: 'terminate' });
    } else if (durationMs > HUNG_WARNING_MS) {
      result.hungCycle = { detected: true, durationMs, action: 'warning' };
      slog('REACTIVE', `hung cycle warning: ${Math.round(durationMs / 1000)}s`);
      eventBus.emit('action:scheduler', { event: 'hung-cycle', durationMs, action: 'warning' });
    } else {
      result.hungCycle = { detected: false, durationMs, action: 'none' };
    }
  }

  return result;
}

// =============================================================================
// Read-only health metrics
// =============================================================================

export function getStarvationMetrics(): { starvedCount: number; maxWaitMs: number } {
  const waitingProcesses = [
    ...getByState('pending'),
    ...getByState('scheduled'),
    ...getByState('suspended'),
  ];

  const now = Date.now();
  let starvedCount = 0;
  let maxWaitMs = 0;

  for (const proc of waitingProcesses) {
    const waitMs = now - new Date(proc.lastActiveAt).getTime();
    if (waitMs > maxWaitMs) maxWaitMs = waitMs;
    if (waitMs > STARVATION_MS) starvedCount++;
  }

  return { starvedCount, maxWaitMs };
}

// =============================================================================
// Status
// =============================================================================

export function getReactivePoliciesStatus(): string {
  const boosted = boostRecords.size;
  return `ReactivePolicies: ${boosted} boosted tasks`;
}

export function clearBoostRecords(): void {
  boostRecords.clear();
}
