/**
 * Agent OS Process Table — unified lifecycle management for tasks
 *
 * Tracks all task processes with state machine transitions.
 * Agent PCB (Process Control Block) stores checkpoint on suspend.
 */

import fs from 'node:fs';
import path from 'node:path';
import { slog } from './utils.js';
import type { TaskSnapshot, SuspendInfo } from './scheduler.js';

// =============================================================================
// Types
// =============================================================================

export type ProcessState = 'pending' | 'running' | 'blocked' | 'suspended' | 'completed' | 'abandoned';

export interface ProcessCheckpoint {
  taskId: string;
  suspendedAt: string;
  reason: 'preempted' | 'attention_budget' | 'blocked' | 'manual';
  resumeHints: string;
  priorityAtSuspend: number;
}

export interface ProcessEntry {
  taskId: string;
  state: ProcessState;
  priority: number;
  source: 'alex' | 'kuro' | 'system' | 'discovery';
  ticksSpent: number;
  createdAt: string;
  lastActiveAt: string;
  checkpoint: ProcessCheckpoint | null;
  blockedBy: string | null;
}

// Valid state transitions
const VALID_TRANSITIONS: Record<ProcessState, ProcessState[]> = {
  pending: ['running', 'abandoned'],
  running: ['blocked', 'suspended', 'completed', 'abandoned'],
  blocked: ['running', 'suspended', 'abandoned'],
  suspended: ['running', 'abandoned'],
  completed: [],
  abandoned: [],
};

// =============================================================================
// Process Table
// =============================================================================

const processes = new Map<string, ProcessEntry>();

export function registerProcess(task: TaskSnapshot): ProcessEntry {
  const existing = processes.get(task.id);
  if (existing) return existing;

  const entry: ProcessEntry = {
    taskId: task.id,
    state: task.status === 'in_progress' ? 'running' : 'pending',
    priority: task.priority,
    source: task.source,
    ticksSpent: task.ticksSpent,
    createdAt: task.createdAt,
    lastActiveAt: new Date().toISOString(),
    checkpoint: null,
    blockedBy: null,
  };

  processes.set(task.id, entry);
  return entry;
}

export function transitionProcess(
  taskId: string,
  to: ProcessState,
  reason?: string,
): boolean {
  const entry = processes.get(taskId);
  if (!entry) {
    slog('PTABLE', `transition failed: ${taskId} not found`);
    return false;
  }

  const allowed = VALID_TRANSITIONS[entry.state];
  if (!allowed.includes(to)) {
    slog('PTABLE', `invalid transition: ${taskId} ${entry.state} → ${to}`);
    return false;
  }

  const from = entry.state;
  entry.state = to;
  entry.lastActiveAt = new Date().toISOString();

  if (to === 'running') {
    entry.checkpoint = null;
    entry.blockedBy = null;
  }

  slog('PTABLE', `${taskId.slice(0, 12)} ${from} → ${to}${reason ? ` (${reason})` : ''}`);
  return true;
}

export function suspendProcess(
  taskId: string,
  info: SuspendInfo,
  resumeHints: string = '',
): boolean {
  const entry = processes.get(taskId);
  if (!entry) return false;

  const ok = transitionProcess(taskId, 'suspended', info.reason);
  if (!ok) return false;

  entry.checkpoint = {
    taskId,
    suspendedAt: new Date().toISOString(),
    reason: info.reason,
    resumeHints,
    priorityAtSuspend: info.priorityAtSuspend,
  };

  return true;
}

export function resumeProcess(taskId: string): ProcessCheckpoint | null {
  const entry = processes.get(taskId);
  if (!entry) return null;

  const checkpoint = entry.checkpoint;
  transitionProcess(taskId, 'running', 'resumed');
  return checkpoint;
}

export function blockProcess(taskId: string, blockedBy: string): boolean {
  const entry = processes.get(taskId);
  if (!entry) return false;

  const ok = transitionProcess(taskId, 'blocked', `blocked by ${blockedBy}`);
  if (ok) entry.blockedBy = blockedBy;
  return ok;
}

export function completeProcess(taskId: string): boolean {
  return transitionProcess(taskId, 'completed', 'done');
}

export function abandonProcess(taskId: string, reason?: string): boolean {
  return transitionProcess(taskId, 'abandoned', reason);
}

// =============================================================================
// Queries
// =============================================================================

export function getProcess(taskId: string): ProcessEntry | null {
  return processes.get(taskId) ?? null;
}

export function getCurrentProcess(): ProcessEntry | null {
  for (const entry of processes.values()) {
    if (entry.state === 'running') return entry;
  }
  return null;
}

export function getByState(state: ProcessState): ProcessEntry[] {
  return Array.from(processes.values()).filter(e => e.state === state);
}

export function getSuspendedProcesses(): ProcessEntry[] {
  return getByState('suspended').sort((a, b) => b.priority - a.priority);
}

export function detectStarvation(thresholdTicks: number): ProcessEntry[] {
  const now = Date.now();
  return Array.from(processes.values())
    .filter(e => {
      if (e.state !== 'pending' && e.state !== 'suspended') return false;
      const waitMs = now - new Date(e.lastActiveAt).getTime();
      const waitTicks = Math.floor(waitMs / 60_000);
      return waitTicks > thresholdTicks;
    });
}

export function incrementTicks(taskId: string): void {
  const entry = processes.get(taskId);
  if (entry) {
    entry.ticksSpent++;
    entry.lastActiveAt = new Date().toISOString();
  }
}

// =============================================================================
// Status
// =============================================================================

export function getProcessTableStatus(): string {
  const states: Record<string, number> = {};
  for (const entry of processes.values()) {
    states[entry.state] = (states[entry.state] ?? 0) + 1;
  }
  const parts = Object.entries(states).map(([s, n]) => `${s}=${n}`);
  return `ProcessTable: ${processes.size} total (${parts.join(', ')})`;
}

export function getProcessTableSnapshot(): ProcessEntry[] {
  return Array.from(processes.values());
}

export function clearProcessTable(): void {
  processes.clear();
}

export function syncFromTasks(tasks: TaskSnapshot[]): void {
  for (const task of tasks) {
    registerProcess(task);
  }
  // Clean up processes whose tasks no longer exist
  for (const [id] of processes) {
    if (!tasks.find(t => t.id === id)) {
      const entry = processes.get(id)!;
      if (entry.state !== 'completed' && entry.state !== 'abandoned') {
        transitionProcess(id, 'abandoned', 'task removed from queue');
      }
    }
  }
}

// =============================================================================
// Persistence — survive process restart
// =============================================================================

let persistPath: string | null = null;

export function initProcessTable(stateDir: string): void {
  persistPath = path.join(stateDir, 'process-table.json');
  try {
    if (fs.existsSync(persistPath)) {
      const data: ProcessEntry[] = JSON.parse(fs.readFileSync(persistPath, 'utf-8'));
      for (const entry of data) {
        if (entry.state !== 'completed' && entry.state !== 'abandoned') {
          processes.set(entry.taskId, entry);
        }
      }
      slog('PTABLE', `restored ${processes.size} processes from disk`);
    }
  } catch { /* fresh start */ }
}

export function persistProcessTable(): void {
  if (!persistPath) return;
  try {
    const dir = path.dirname(persistPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const active = Array.from(processes.values())
      .filter(e => e.state !== 'completed' && e.state !== 'abandoned');
    fs.writeFileSync(persistPath, JSON.stringify(active, null, 2), 'utf-8');
  } catch { /* fire-and-forget */ }
}
