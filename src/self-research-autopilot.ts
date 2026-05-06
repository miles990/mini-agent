/**
 * Self Research Autopilot.
 *
 * Bridges idle/open cycles into the normal scheduler. It only creates a
 * proposal and a P2 task; execution still goes through the existing task
 * scheduler and verification gate.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
  maintenance?: MaintenanceDebt;
}

export interface MaintenanceDebt {
  kind: 'pr-conflict';
  prNumber: number;
  title: string;
  action: 'needs-decomposition' | 'needs-verification';
  reason: string;
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

  const openTasks = queryMemoryIndexSync(memoryDir, {
    type: ['task'],
    status: ['pending', 'in_progress', 'needs-decomposition', 'blocked', 'hold'],
  });
  const queuedMaintenance = await maybeQueueMaintenance(memoryDir, openTasks);
  if (queuedMaintenance) return queuedMaintenance;

  const activeTasks = queryMemoryIndexSync(memoryDir, {
    type: ['task'],
    status: ['pending', 'in_progress', 'needs-decomposition', 'blocked'],
  });
  if (activeTasks.length > 0) {
    return { queued: false, reason: 'active-tasks-present' };
  }

  const existing = openTasks.find(entry => (entry.summary ?? '').includes('execute self-research'));
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

async function maybeQueueMaintenance(
  memoryDir: string,
  openTasks: MemoryIndexEntry[],
): Promise<SelfResearchAutopilotResult | null> {
  const debt = findTopMaintenanceDebt(memoryDir);
  if (!debt) return null;

  const marker = `autonomous maintenance PR #${debt.prNumber}`;
  if (openTasks.some(task => (task.summary ?? '').includes(marker))) {
    return { queued: false, reason: 'maintenance-task-exists', maintenance: debt };
  }

  const activeNonMaintenance = openTasks.filter(task =>
    ['pending', 'in_progress', 'needs-decomposition'].includes(String(task.status))
    && !(task.summary ?? '').includes('autonomous maintenance'),
  );
  if (activeNonMaintenance.length > 0) return null;

  const task = await createTask(memoryDir, {
    title: `P1 ${marker}: ${maintenanceAction(debt)} for ${debt.title}`,
    origin: 'scheduler',
    priority: 1,
    assignee: 'kuro',
    verify_command: prConflictVerifyCommand(debt.prNumber),
    acceptance_criteria: maintenanceAcceptance(debt),
  });

  eventBus.emit('action:task', {
    event: 'autonomous-maintenance-queued',
    taskId: task.id,
    kind: debt.kind,
    prNumber: debt.prNumber,
    action: debt.action,
  });

  return { queued: true, reason: 'maintenance-queued', maintenance: debt, task };
}

function findTopMaintenanceDebt(memoryDir: string): MaintenanceDebt | null {
  const activePath = path.join(memoryDir, 'handoffs', 'active.md');
  if (!existsSync(activePath)) return null;

  const debts = readFileSync(activePath, 'utf-8')
    .split('\n')
    .map(parseConflictDebtRow)
    .filter((debt): debt is MaintenanceDebt => debt !== null);

  return debts.sort((a, b) => maintenancePriority(b) - maintenancePriority(a))[0] ?? null;
}

function parseConflictDebtRow(line: string): MaintenanceDebt | null {
  if (!line.includes('| blocked |') || !line.includes('conflict diagnostic')) return null;
  const match = line.match(/PR #(\d+) conflict diagnostic:\s*(.*?)\s*\((needs-decomposition|needs-verification);\s*(.*?)\)\s*\|\s*blocked\s*\|/);
  if (!match) return null;
  return {
    kind: 'pr-conflict',
    prNumber: Number(match[1]),
    title: unescapeTable(match[2].trim()),
    action: match[3] as MaintenanceDebt['action'],
    reason: unescapeTable(match[4].trim()),
  };
}

function maintenancePriority(debt: MaintenanceDebt): number {
  return debt.action === 'needs-decomposition' ? 2 : 1;
}

function maintenanceAction(debt: MaintenanceDebt): string {
  return debt.action === 'needs-decomposition'
    ? 'rebuild or split conflicting broad PR from current main'
    : 'add completed verification evidence or close obsolete conflicting PR';
}

function maintenanceAcceptance(debt: MaintenanceDebt): string {
  if (debt.action === 'needs-decomposition') {
    return `Resolve PR #${debt.prNumber} debt by rebuilding/splitting from current main, or closing it as superseded with a replacement PR/issue. Do not merge broad conflicting scope directly. Reason: ${debt.reason}`;
  }
  return `Resolve PR #${debt.prNumber} debt by adding completed verification evidence and re-running review, or closing it as obsolete. Reason: ${debt.reason}`;
}

function prConflictVerifyCommand(prNumber: number): string {
  return [
    'test "$(',
    `gh pr view ${prNumber} --repo miles990/mini-agent --json state,mergeable --jq `,
    shellQuote('if .state == "MERGED" or .mergeable != "CONFLICTING" then "ok" else "blocked" end'),
    ')" = ok',
  ].join('');
}

function unescapeTable(value: string): string {
  return value.replace(/\\\|/g, '|').replace(/\s+/g, ' ').trim();
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
