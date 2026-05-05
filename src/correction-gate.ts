import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createTask, queryMemoryIndexSync, updateMemoryIndexEntry, type MemoryIndexEntry } from './memory-index.js';
import { getHealthSignals } from './pulse.js';

export type CorrectionReasonType =
  | 'pending-pledge'
  | 'low-responsiveness'
  | 'low-output-quality'
  | 'local-commit-not-pushed';

export interface CorrectionReason {
  type: CorrectionReasonType;
  severity: 'medium' | 'high';
  message: string;
  taskId?: string;
}

export interface HealthBreakdown {
  fulfillment: { value: number; weight: number; contribution: number; detail: string };
  responsiveness: { value: number; weight: number; contribution: number; detail: string };
  quality: { value: number; weight: number; contribution: number; detail: string };
}

export interface ShipTruthState {
  repoPresent: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  dirty: boolean;
  state: 'not-repo' | 'clean' | 'dirty' | 'pending-push' | 'behind' | 'diverged' | 'unknown';
}

export interface CorrectionGateSnapshot {
  score: number;
  needsCorrection: boolean;
  breakdown: HealthBreakdown;
  guidance: string[];
  anomalies: string[];
  reasons: CorrectionReason[];
  suppressedActions: string[];
  shipTruth: ShipTruthState;
}

export function evaluateCorrectionGate(memoryDir: string, repoRoot = process.cwd()): CorrectionGateSnapshot {
  const signals = getHealthSignals();
  const allTasks = queryMemoryIndexSync(memoryDir, { type: ['task'] });
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();

  const recentTasks = allTasks.filter(t => (t.ts ?? '') >= sevenDaysAgo);
  const pledgeTasks = recentTasks.filter(t => (t.payload as Record<string, unknown>)?.origin === 'pledge');
  const pledgesDone = pledgeTasks.filter(t => ['completed', 'done'].includes(t.status)).length;
  const pledgesTotal = Math.max(1, pledgeTasks.length);
  const fulfillment = pledgeTasks.length === 0 ? 0.7 : pledgesDone / pledgesTotal;

  const activeTasks = allTasks.filter(t =>
    ['pending', 'in_progress'].includes(t.status) &&
    !(t.payload as Record<string, unknown>)?.goal_id
  );
  const avgStaleness = activeTasks.length === 0 ? 0 :
    activeTasks.reduce((sum, t) => sum + ((t.payload as Record<string, unknown>)?.ticksSinceLastProgress as number ?? 0), 0) / activeTasks.length;
  const responsiveness = activeTasks.length === 0 ? 0.8 : Math.max(0, 1 - avgStaleness / 10);

  const outputRate = signals.visibleOutputRate;
  const hasPulseHistory = signals.cycleCount >= 5;
  const quality = hasPulseHistory ? Math.min(outputRate * 1.5, 1) : 0.7;
  const score = Math.min(Math.round(fulfillment * 40 + responsiveness * 35 + quality * 25), 100);

  const reasons: CorrectionReason[] = [];
  const guidance: string[] = [];

  if (fulfillment < 0.5) {
    const unfinished = pledgeTasks.filter(t => !['completed', 'done'].includes(t.status));
    const oldest = unfinished[0];
    const message = `承諾兌現率低 (${Math.round(fulfillment * 100)}%) — ${unfinished.length} 個 pledge 未完成${oldest ? `，最老: ${oldest.summary?.slice(0, 50)}` : ''}。現在做。`;
    reasons.push({ type: 'pending-pledge', severity: 'high', message, taskId: oldest?.id });
    guidance.push(message);
  }

  if (responsiveness < 0.5) {
    const stalest = [...activeTasks].sort((a, b) => ((b.payload as Record<string, unknown>)?.ticksSinceLastProgress as number ?? 0) - ((a.payload as Record<string, unknown>)?.ticksSinceLastProgress as number ?? 0))[0];
    const message = `響應力低 (${Math.round(responsiveness * 100)}%) — 平均 ${avgStaleness.toFixed(1)} cycles 沒進展${stalest ? `，最停滯: ${stalest.summary?.slice(0, 50)}` : ''}。推進它。`;
    reasons.push({ type: 'low-responsiveness', severity: 'medium', message, taskId: stalest?.id });
    guidance.push(message);
  }

  if (hasPulseHistory && quality < 0.4) {
    const message = `產出品質低 (${Math.round(quality * 100)}%) — 多數 cycle 無 visible output。交付成品，不要只思考。`;
    reasons.push({ type: 'low-output-quality', severity: 'medium', message });
    guidance.push(message);
  }

  const shipTruth = readShipTruth(repoRoot);
  if (shipTruth.state === 'pending-push' || shipTruth.state === 'diverged') {
    const message = `交付狀態未完成 — local branch ahead origin ${shipTruth.ahead} commit(s)，只能視為 committed-local/pending-push，不是 shipped。`;
    reasons.push({ type: 'local-commit-not-pushed', severity: 'high', message });
    guidance.push(message);
  }

  const needsCorrection = reasons.length > 0;
  const suppressedActions = needsCorrection
    ? ['self-research', 'open-cycle-discovery']
    : [];

  return {
    score,
    needsCorrection,
    breakdown: {
      fulfillment: { value: fulfillment, weight: 40, contribution: Math.round(fulfillment * 40 * 10) / 10, detail: `${pledgesDone}/${pledgesTotal} pledges` },
      responsiveness: { value: responsiveness, weight: 35, contribution: Math.round(responsiveness * 35 * 10) / 10, detail: `avg staleness ${avgStaleness.toFixed(1)}` },
      quality: { value: quality, weight: 25, contribution: Math.round(quality * 25 * 10) / 10, detail: `output rate ${Math.round(outputRate * 100)}%` },
    },
    guidance,
    anomalies: needsCorrection ? ['needs-correction'] : [],
    reasons,
    suppressedActions,
    shipTruth,
  };
}

export async function ensureCorrectionTask(memoryDir: string, snapshot = evaluateCorrectionGate(memoryDir)): Promise<MemoryIndexEntry | null> {
  if (!snapshot.needsCorrection) return null;
  const existing = queryMemoryIndexSync(memoryDir, {
    type: ['task'],
    status: ['pending', 'in_progress', 'needs-decomposition', 'blocked'],
  }).find(entry => isCorrectionTask(entry));
  if (existing) return existing;

  const primary = snapshot.reasons.find(r => r.severity === 'high') ?? snapshot.reasons[0];
  if (!primary) return null;

  return createTask(memoryDir, {
    title: `P0 correction gate: resolve ${primary.type}`,
    origin: 'scheduler',
    priority: 0,
    verify_command: 'pnpm typecheck && pnpm test',
    acceptance_criteria: [
      primary.message,
      'Resolve the active correction reason or write a falsifiable blocker.',
      `Current suppressed actions: ${snapshot.suppressedActions.join(', ') || 'none'}.`,
      `Ship truth state: ${snapshot.shipTruth.state}.`,
    ].join(' '),
  });
}

export async function closeResolvedCorrectionTasks(
  memoryDir: string,
  snapshot = evaluateCorrectionGate(memoryDir),
): Promise<MemoryIndexEntry[]> {
  if (snapshot.needsCorrection) return [];

  const activeCorrectionTasks = queryMemoryIndexSync(memoryDir, {
    type: ['task'],
    status: ['pending', 'in_progress', 'needs-decomposition', 'blocked'],
  }).filter(isCorrectionTask);

  const closed: MemoryIndexEntry[] = [];
  for (const task of activeCorrectionTasks) {
    const payload = {
      ...((task.payload ?? {}) as Record<string, unknown>),
      correction_resolved_at: new Date().toISOString(),
      correction_resolution: 'gate-clean',
    };
    const updated = await updateMemoryIndexEntry(memoryDir, task.id, {
      status: 'completed',
      payload,
    });
    if (updated) closed.push(updated);
  }
  return closed;
}

export function isCorrectionTask(entry: Pick<MemoryIndexEntry, 'summary' | 'payload'>): boolean {
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  return (entry.summary ?? '').includes('correction gate') || payload.origin === 'correction-gate';
}

function readShipTruth(repoRoot: string): ShipTruthState {
  if (!existsSync(path.join(repoRoot, '.git'))) {
    return { repoPresent: false, branch: null, ahead: 0, behind: 0, dirty: false, state: 'not-repo' };
  }

  try {
    const status = execSync('git status --porcelain=v2 --branch', {
      cwd: repoRoot,
      encoding: 'utf-8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parseGitStatusPorcelainV2(status);
  } catch {
    return { repoPresent: true, branch: null, ahead: 0, behind: 0, dirty: false, state: 'unknown' };
  }
}

export function parseGitStatusPorcelainV2(status: string): ShipTruthState {
  let branch: string | null = null;
  let ahead = 0;
  let behind = 0;
  let dirty = false;

  for (const line of status.split('\n')) {
    if (line.startsWith('# branch.head ')) branch = line.slice('# branch.head '.length).trim();
    if (line.startsWith('# branch.ab ')) {
      const aheadMatch = line.match(/\+(\d+)/);
      const behindMatch = line.match(/-(\d+)/);
      ahead = aheadMatch ? Number(aheadMatch[1]) : 0;
      behind = behindMatch ? Number(behindMatch[1]) : 0;
    }
    if (line && !line.startsWith('#')) dirty = true;
  }

  let state: ShipTruthState['state'] = 'clean';
  if (ahead > 0 && behind > 0) state = 'diverged';
  else if (ahead > 0) state = 'pending-push';
  else if (behind > 0) state = 'behind';
  else if (dirty) state = 'dirty';

  return { repoPresent: true, branch, ahead, behind, dirty, state };
}
