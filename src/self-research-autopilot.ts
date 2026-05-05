/**
 * Self Research Autopilot.
 *
 * Bridges idle/open cycles into the normal scheduler. It only creates a
 * proposal and a P2 task; execution still goes through the existing task
 * scheduler and verification gate.
 */

import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { eventBus } from './event-bus.js';
import { createTask, queryMemoryIndexSync, type MemoryIndexEntry } from './memory-index.js';
import { createSelfResearchPlan, saveSelfResearchPlan, type SelfResearchRun } from './self-research-loop.js';
import { evaluateCorrectionGate } from './correction-gate.js';

export interface SelfResearchAutopilotOptions {
  triggerReason?: string | null;
  now?: Date;
}

export interface SelfResearchAutopilotResult {
  queued: boolean;
  reason: string;
  run?: SelfResearchRun;
  proposalPath?: string;
  task?: MemoryIndexEntry;
}

export async function maybeQueueSelfResearch(
  memoryDir: string,
  opts: SelfResearchAutopilotOptions = {},
): Promise<SelfResearchAutopilotResult> {
  const trigger = opts.triggerReason ?? '';
  if (!isIdleTrigger(trigger)) {
    return { queued: false, reason: 'not-idle-trigger' };
  }

  const correction = evaluateCorrectionGate(memoryDir);
  if (correction.needsCorrection) {
    return { queued: false, reason: `suppressed-by-correction:${correction.reasons[0]?.type ?? 'unknown'}` };
  }

  const activeTasks = queryMemoryIndexSync(memoryDir, {
    type: ['task'],
    status: ['pending', 'in_progress', 'needs-decomposition', 'blocked'],
  });
  if (activeTasks.length > 0) {
    return { queued: false, reason: 'active-tasks-present' };
  }

  const existing = queryMemoryIndexSync(memoryDir, {
    type: ['task'],
    status: ['pending', 'in_progress', 'needs-decomposition', 'blocked', 'hold'],
  }).find(entry => (entry.summary ?? '').includes('execute self-research'));
  if (existing) {
    return { queued: false, reason: 'self-research-task-exists' };
  }

  if (hasSelfResearchProposalToday(memoryDir, opts.now ?? new Date())) {
    return { queued: false, reason: 'daily-proposal-already-exists' };
  }

  const run = createSelfResearchPlan(memoryDir, { now: opts.now });
  const proposalPath = saveSelfResearchPlan(memoryDir, run);
  const task = await createTask(memoryDir, {
    title: `P2 execute self-research ${run.target}: produce ${run.artifactType} at ${run.artifactPath}`,
    origin: 'scheduler',
    priority: 2,
    verify_command: `test -s ${shellQuote(run.artifactPath)}`,
    acceptance_criteria: `Complete ${proposalPath}; produce required artifact at ${run.artifactPath}; record learning return and KG links.`,
  });
  eventBus.emit('action:task', {
    event: 'self-research-queued',
    taskId: task.id,
    target: run.target,
    proposalPath,
    artifactPath: run.artifactPath,
  });

  return { queued: true, reason: 'queued', run, proposalPath, task };
}

function isIdleTrigger(trigger: string): boolean {
  return trigger === '' || trigger.includes('heartbeat') || trigger.startsWith('workspace');
}

function hasSelfResearchProposalToday(memoryDir: string, now: Date): boolean {
  const proposalDir = path.join(memoryDir, 'proposals');
  if (!existsSync(proposalDir)) return false;
  const today = now.toISOString().slice(0, 10).replace(/-/g, '');
  return readdirSync(proposalDir).some(file => file.startsWith(`self-research-${today}`) && file.endsWith('.md'));
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
