import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createTask, queryMemoryIndexSync, updateMemoryIndexEntry, type MemoryIndexEntry } from './memory-index.js';
import { getHealthSignals } from './pulse.js';
import { writeMemoryTriple } from './kg-memory.js';
import { observe as kbObserve } from './shared-knowledge.js';
import {
  loadCorrectionHolds,
  findActiveHold,
  type ActiveHoldMatch,
  type CorrectionHold,
} from './correction-holds.js';
import { evaluateWorkspaceIsolation, isCodePath, isSafeRuntimeBranch, refreshGitIndex } from './workspace-isolation.js';

export type CorrectionReasonType =
  | 'pending-pledge'
  | 'low-responsiveness'
  | 'low-output-quality'
  | 'local-commit-not-pushed'
  | 'runtime-workspace-wrong-branch'
  | 'dirty-runtime-workspace';

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
  headSha: string | null;
  ahead: number;
  behind: number;
  dirty: boolean;
  dirtyPaths: string[];
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
  acknowledgedHolds: ActiveHoldMatch[];
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

  const holds = loadCorrectionHolds(memoryDir);
  const acknowledgedHolds: ActiveHoldMatch[] = [];

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
    const respHold = findActiveHold(holds, 'low-responsiveness', {}, { repoRoot });
    if (respHold) {
      acknowledgedHolds.push(respHold);
      guidance.push(`響應力低 (${Math.round(responsiveness * 100)}%) 但有 active hold (${respHold.matchedBy}): ${respHold.hold.reason}`);
    } else {
      const stalest = [...activeTasks].sort((a, b) => ((b.payload as Record<string, unknown>)?.ticksSinceLastProgress as number ?? 0) - ((a.payload as Record<string, unknown>)?.ticksSinceLastProgress as number ?? 0))[0];
      const message = `響應力低 (${Math.round(responsiveness * 100)}%) — 平均 ${avgStaleness.toFixed(1)} cycles 沒進展${stalest ? `，最停滯: ${stalest.summary?.slice(0, 50)}` : ''}。推進它。`;
      reasons.push({ type: 'low-responsiveness', severity: 'medium', message, taskId: stalest?.id });
      guidance.push(message);
    }
  }

  if (hasPulseHistory && quality < 0.4) {
    const message = `產出品質低 (${Math.round(quality * 100)}%) — 多數 cycle 無 visible output。交付成品，不要只思考。`;
    reasons.push({ type: 'low-output-quality', severity: 'medium', message });
    guidance.push(message);
  }

  const shipTruth = readShipTruth(repoRoot);
  const workspaceIsolation = evaluateWorkspaceIsolation(repoRoot);

  if (workspaceIsolation.protectedRuntimeWorkspace && shipTruth.repoPresent && !isSafeRuntimeBranch(shipTruth.branch)) {
    const match = findActiveHold(holds, 'runtime-workspace-wrong-branch', {
      branch: shipTruth.branch,
      sha: shipTruth.headSha,
    }, { repoRoot });

    if (match) {
      // Documented external hold (e.g., active PR work on a feature branch) — track for visibility, do NOT dispatch P0.
      acknowledgedHolds.push(match);
      guidance.push(
        `runtime workspace 在 ${shipTruth.branch ?? 'unknown'} 但有 active hold (${match.matchedBy}): ${match.hold.reason}`,
      );
    } else {
      const message = `runtime workspace 在錯誤分支 ${shipTruth.branch ?? 'unknown'} — protected runtime checkout 只能在 runtime/main；功能修改要用 isolated worktree + PR。`;
      reasons.push({ type: 'runtime-workspace-wrong-branch', severity: 'high', message });
      guidance.push(message);
    }
  }

  if (workspaceIsolation.protectedRuntimeWorkspace && (shipTruth.state === 'pending-push' || shipTruth.state === 'diverged')) {
    const match = findActiveHold(holds, 'local-commit-not-pushed', {
      branch: shipTruth.branch,
      sha: shipTruth.headSha,
    }, { repoRoot });

    if (match) {
      // Documented external hold — track for visibility, do NOT dispatch P0.
      acknowledgedHolds.push(match);
      guidance.push(
        `交付狀態 ahead ${shipTruth.ahead} commit(s) 但有 active hold (${match.matchedBy}): ${match.hold.reason}`,
      );
    } else {
      const message = `交付狀態未完成 — local branch ahead origin ${shipTruth.ahead} commit(s)，只能視為 committed-local/pending-push，不是 shipped。`;
      reasons.push({ type: 'local-commit-not-pushed', severity: 'high', message });
      guidance.push(message);
    }
  }

  if (workspaceIsolation.protectedRuntimeWorkspace && shipTruth.state === 'dirty') {
    const blockingDirtyPaths = getBlockingRuntimeDirtyPaths(shipTruth.dirtyPaths);
    const match = findActiveHold(holds, 'dirty-runtime-workspace', {
      branch: shipTruth.branch,
      sha: shipTruth.headSha,
    }, { repoRoot });

    if (blockingDirtyPaths.length === 0) {
      guidance.push(
        `runtime workspace 只有非阻塞狀態變更: ${shipTruth.dirtyPaths.slice(0, 5).join(', ') || 'unknown paths'}`,
      );
    } else if (match) {
      acknowledgedHolds.push(match);
      guidance.push(
        `runtime workspace dirty 但有 active hold (${match.matchedBy}): ${match.hold.reason}`,
      );
    } else {
      const paths = blockingDirtyPaths.slice(0, 5).join(', ') || 'unknown paths';
      const message = `runtime workspace 有未整理變更 — ${paths}。先提交、移出、或清理，不能把部署 checkout 當開發/產物工作區。`;
      reasons.push({ type: 'dirty-runtime-workspace', severity: 'high', message });
      guidance.push(message);
    }
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
    acknowledgedHolds,
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

  const runtimeAutocorrect = primary.type === 'local-commit-not-pushed'
    ? [
      'Run runtime autocorrect before manual edits: `pnpm exec tsx scripts/runtime-workspace-autocorrect.ts --apply`.',
      'Expected loop: preserve change in isolated worktree branch, open PR, review, merge, deploy, and confirm runtime/main is clean.',
    ].join(' ')
    : primary.type === 'dirty-runtime-workspace'
      ? [
        'Do not edit protected runtime checkout directly.',
        'Move the change into an isolated worktree/PR, then clean runtime/main and verify `git status --short --branch` is clean.',
      ].join(' ')
      : '';

  const task = await createTask(memoryDir, {
    title: `P0 correction gate: resolve ${primary.type}`,
    origin: 'scheduler',
    priority: 0,
    verify_command: primary.type === 'local-commit-not-pushed'
      ? 'pnpm exec tsx scripts/runtime-workspace-autocorrect.ts --apply && pnpm typecheck && pnpm test'
      : 'pnpm typecheck && pnpm test',
    acceptance_criteria: [
      primary.message,
      runtimeAutocorrect,
      'Resolve the active correction reason or write a falsifiable blocker.',
      `Current suppressed actions: ${snapshot.suppressedActions.join(', ') || 'none'}.`,
      `Ship truth state: ${snapshot.shipTruth.state}.`,
    ].join(' '),
  });

  const payload = {
    ...((task.payload ?? {}) as Record<string, unknown>),
    correction_reason_type: primary.type,
    correction_reason_message: primary.message,
    correction_started_at: new Date().toISOString(),
    correction_initial_score: snapshot.score,
    correction_initial_ship_truth: snapshot.shipTruth.state,
    suppressed_actions: snapshot.suppressedActions,
  };
  const enriched = await updateMemoryIndexEntry(memoryDir, task.id, { payload });
  kbObserve({
    source: 'correction',
    type: 'habit',
    data: {
      phase: 'started',
      taskId: task.id,
      reasonType: primary.type,
      score: snapshot.score,
      shipTruth: snapshot.shipTruth.state,
      suppressedActions: snapshot.suppressedActions,
    },
    tags: ['correction', 'habit-repair', primary.type, snapshot.shipTruth.state],
  });
  return enriched ?? task;
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
      correction_final_score: snapshot.score,
      correction_final_ship_truth: snapshot.shipTruth.state,
    };
    const updated = await updateMemoryIndexEntry(memoryDir, task.id, {
      status: 'completed',
      payload,
    });
    if (updated) {
      closed.push(updated);
      recordCorrectionLearning(updated, snapshot);
    }
  }
  return closed;
}

export function isCorrectionTask(entry: Pick<MemoryIndexEntry, 'summary' | 'payload'>): boolean {
  const payload = (entry.payload ?? {}) as Record<string, unknown>;
  return (entry.summary ?? '').includes('correction gate') || payload.origin === 'correction-gate';
}

function recordCorrectionLearning(task: MemoryIndexEntry, snapshot: CorrectionGateSnapshot): void {
  const payload = (task.payload ?? {}) as Record<string, unknown>;
  const reasonType = typeof payload.correction_reason_type === 'string'
    ? payload.correction_reason_type
    : parseCorrectionReasonFromSummary(task.summary ?? '');
  const reasonMessage = typeof payload.correction_reason_message === 'string'
    ? payload.correction_reason_message
    : task.summary ?? 'correction gate resolved';
  const initialScore = typeof payload.correction_initial_score === 'number' ? payload.correction_initial_score : null;
  const finalScore = snapshot.score;
  const shipTruth = typeof payload.correction_initial_ship_truth === 'string'
    ? `${payload.correction_initial_ship_truth}→${snapshot.shipTruth.state}`
    : snapshot.shipTruth.state;

  kbObserve({
    source: 'correction',
    type: 'habit',
    data: {
      phase: 'resolved',
      taskId: task.id,
      reasonType,
      reasonMessage,
      initialScore,
      finalScore,
      shipTruth,
      resolution: 'gate-clean',
    },
    tags: ['correction', 'habit-repair', reasonType, 'gate-clean'].filter(Boolean),
    outcome: 'success',
  });

  writeMemoryTriple({
    agent: 'kuro',
    predicate: 'learned',
    topic: 'habits',
    importance: reasonType === 'pending-pledge' || reasonType === 'local-commit-not-pushed' ? 'high' : 'medium',
    visibility: 'shared',
    source: 'correction-gate',
    content: [
      `Correction habit repaired: ${reasonType}.`,
      `Trigger: ${reasonMessage}`,
      `Gate result: clean; score ${initialScore ?? 'unknown'}→${finalScore}; ship truth ${shipTruth}.`,
      'Keep pledge fulfillment and ship-truth checks ahead of self-research/open-cycle.',
    ].join(' '),
  });
}

function parseCorrectionReasonFromSummary(summary: string): string {
  const match = summary.match(/correction gate: resolve ([a-z-]+)/i);
  return match?.[1] ?? 'unknown';
}

function readShipTruth(repoRoot: string): ShipTruthState {
  if (!existsSync(path.join(repoRoot, '.git'))) {
    return { repoPresent: false, branch: null, headSha: null, ahead: 0, behind: 0, dirty: false, dirtyPaths: [], state: 'not-repo' };
  }

  try {
    refreshGitIndex(repoRoot);
    const status = execSync('git status --porcelain=v2 --branch', {
      cwd: repoRoot,
      encoding: 'utf-8',
      timeout: 2000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return parseGitStatusPorcelainV2(status);
  } catch {
    return { repoPresent: true, branch: null, headSha: null, ahead: 0, behind: 0, dirty: false, dirtyPaths: [], state: 'unknown' };
  }
}

export function parseGitStatusPorcelainV2(status: string): ShipTruthState {
  let branch: string | null = null;
  let headSha: string | null = null;
  let ahead = 0;
  let behind = 0;
  let dirty = false;
  const dirtyPaths: string[] = [];

  for (const line of status.split('\n')) {
    if (line.startsWith('# branch.oid ')) {
      const oid = line.slice('# branch.oid '.length).trim();
      headSha = oid && oid !== '(initial)' ? oid : null;
    }
    if (line.startsWith('# branch.head ')) branch = line.slice('# branch.head '.length).trim();
    if (line.startsWith('# branch.ab ')) {
      const aheadMatch = line.match(/\+(\d+)/);
      const behindMatch = line.match(/-(\d+)/);
      ahead = aheadMatch ? Number(aheadMatch[1]) : 0;
      behind = behindMatch ? Number(behindMatch[1]) : 0;
    }
    if (line && !line.startsWith('#')) {
      dirty = true;
      const parts = line.split(' ');
      const path = parts[parts.length - 1]?.trim();
      if (path) dirtyPaths.push(path);
    }
  }

  let state: ShipTruthState['state'] = 'clean';
  if (ahead > 0 && behind > 0) state = 'diverged';
  else if (ahead > 0) state = 'pending-push';
  else if (behind > 0) state = 'behind';
  else if (dirty) state = 'dirty';

  return { repoPresent: true, branch, headSha, ahead, behind, dirty, dirtyPaths, state };
}

export function getBlockingRuntimeDirtyPaths(paths: string[]): string[] {
  return paths.filter(isCodePath);
}
