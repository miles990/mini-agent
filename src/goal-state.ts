/**
 * Goal State Machine — 完整的目標生命週期管理
 *
 * 感知 → 目標清單（排序）→ 拿最高優先 → 計劃 → 確認 → 實作 → 驗證 → 版控 → 部署 → 回到感知
 *
 * 每個階段都記錄回報。
 */

import fs from 'node:fs';
import path from 'node:path';
import { getMemoryStateDir } from './memory.js';
import { slog } from './utils.js';

/** Goal execution phases — the lifecycle every goal follows */
export type GoalPhase =
  | 'planning'      // 定計劃
  | 'confirmed'     // 確認計畫沒問題
  | 'implementing'  // 照計畫實作
  | 'verifying'     // 實作完驗證
  | 'committing'    // 版控
  | 'deploying';    // 部署更新

export const PHASE_ORDER: GoalPhase[] = [
  'planning', 'confirmed', 'implementing', 'verifying', 'committing', 'deploying',
];

const PHASE_LABELS: Record<GoalPhase, string> = {
  planning: '定計劃',
  confirmed: '確認計畫',
  implementing: '實作中',
  verifying: '驗證中',
  committing: '版控中',
  deploying: '部署中',
};

export interface ActiveGoal {
  id: string;
  description: string;
  origin: string;
  phase: GoalPhase;
  steps: string[];
  progress: string[];
  status: 'active' | 'completed' | 'superseded' | 'abandoned';
  createdAt: string;
  updatedAt: string;
  supersededBy?: string;
  priority?: number; // lower = higher priority
}

interface GoalState {
  active: ActiveGoal | null;
  queue: ActiveGoal[];  // prioritized goal backlog
  history: ActiveGoal[];
}

const HISTORY_LIMIT = 5;
const QUEUE_LIMIT = 10;

function getGoalStatePath(): string {
  return path.join(getMemoryStateDir(), 'goal-state.json');
}

export function loadGoalState(): GoalState {
  try {
    const data = fs.readFileSync(getGoalStatePath(), 'utf-8');
    const state = JSON.parse(data) as GoalState;
    // Migration: ensure queue exists
    if (!state.queue) state.queue = [];
    // Migration: ensure phase exists on active goal
    if (state.active && !state.active.phase) state.active.phase = 'planning';
    return state;
  } catch {
    return { active: null, queue: [], history: [] };
  }
}

function saveGoalState(state: GoalState): void {
  fs.writeFileSync(getGoalStatePath(), JSON.stringify(state, null, 2), 'utf-8');
}

/** Queue a new goal (perception → goal list → prioritize). Does NOT activate it. */
export function queueGoal(description: string, origin?: string, priority?: number): ActiveGoal {
  const state = loadGoalState();
  const now = new Date().toISOString();

  const goal: ActiveGoal = {
    id: `goal-${Date.now()}`,
    description,
    origin: origin ?? 'perception',
    phase: 'planning',
    steps: [],
    progress: [],
    status: 'active',
    createdAt: now,
    updatedAt: now,
    priority: priority ?? state.queue.length,
  };

  state.queue.push(goal);
  // Sort by priority (lower number = higher priority)
  state.queue.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99));
  state.queue = state.queue.slice(0, QUEUE_LIMIT);
  saveGoalState(state);
  slog('GOAL', `Queued: ${description.slice(0, 80)} (priority=${goal.priority})`);
  return goal;
}

/** Activate the highest-priority queued goal, or create a new one directly. */
export function createGoal(description: string, origin?: string): ActiveGoal {
  const state = loadGoalState();
  const now = new Date().toISOString();

  // Supersede current active goal if exists
  if (state.active) {
    state.active.status = 'superseded';
    state.active.supersededBy = `goal-${Date.now()}`;
    state.active.updatedAt = now;
    state.history.unshift(state.active);
    state.history = state.history.slice(0, HISTORY_LIMIT);
  }

  const goal: ActiveGoal = {
    id: `goal-${Date.now()}`,
    description,
    origin: origin ?? 'perception',
    phase: 'planning',
    steps: [],
    progress: [],
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };

  state.active = goal;

  // Remove from queue if it was queued
  state.queue = state.queue.filter(q => q.description !== description);

  saveGoalState(state);
  slog('GOAL', `Created: ${description.slice(0, 80)} [phase: planning]`);
  return goal;
}

/** Promote the next queued goal to active. Returns null if queue is empty. */
export function promoteNextGoal(): ActiveGoal | null {
  const state = loadGoalState();
  if (state.queue.length === 0) return null;

  const next = state.queue.shift()!;
  const now = new Date().toISOString();

  // Shelve current active goal back to queue if exists
  if (state.active && state.active.status === 'active') {
    state.active.status = 'superseded';
    state.active.updatedAt = now;
    state.history.unshift(state.active);
    state.history = state.history.slice(0, HISTORY_LIMIT);
  }

  next.updatedAt = now;
  state.active = next;
  saveGoalState(state);
  slog('GOAL', `Promoted from queue: ${next.description.slice(0, 80)}`);
  return next;
}

/** Advance to the next phase. Returns null if no active goal or already at last phase. */
export function advanceGoalPhase(report?: string): ActiveGoal | null {
  const state = loadGoalState();
  if (!state.active) return null;

  const currentIdx = PHASE_ORDER.indexOf(state.active.phase);
  if (currentIdx < 0 || currentIdx >= PHASE_ORDER.length - 1) return null;

  const prevPhase = state.active.phase;
  const nextPhase = PHASE_ORDER[currentIdx + 1];
  state.active.phase = nextPhase;
  state.active.updatedAt = new Date().toISOString();

  const logEntry = report
    ? `[${PHASE_LABELS[prevPhase]}→${PHASE_LABELS[nextPhase]}] ${report}`
    : `[${PHASE_LABELS[prevPhase]}→${PHASE_LABELS[nextPhase]}]`;
  state.active.progress.push(logEntry);

  saveGoalState(state);
  slog('GOAL', `Phase: ${prevPhase} → ${nextPhase}${report ? ': ' + report.slice(0, 60) : ''}`);
  return state.active;
}

export function progressGoal(note: string): ActiveGoal | null {
  const state = loadGoalState();
  if (!state.active) return null;

  state.active.progress.push(note);
  state.active.updatedAt = new Date().toISOString();
  saveGoalState(state);
  slog('GOAL', `Progress: ${note.slice(0, 80)}`);
  return state.active;
}

export function completeGoal(summary: string): ActiveGoal | null {
  const state = loadGoalState();
  if (!state.active) return null;

  state.active.status = 'completed';
  state.active.progress.push(`✅ ${summary}`);
  state.active.updatedAt = new Date().toISOString();
  state.history.unshift(state.active);
  state.history = state.history.slice(0, HISTORY_LIMIT);
  const completed = state.active;
  state.active = null;
  saveGoalState(state);
  slog('GOAL', `Completed: ${summary.slice(0, 80)}`);
  return completed;
}

export function abandonGoal(reason: string): ActiveGoal | null {
  const state = loadGoalState();
  if (!state.active) return null;

  state.active.status = 'abandoned';
  state.active.progress.push(`❌ ${reason}`);
  state.active.updatedAt = new Date().toISOString();
  state.history.unshift(state.active);
  state.history = state.history.slice(0, HISTORY_LIMIT);
  const abandoned = state.active;
  state.active = null;
  saveGoalState(state);
  slog('GOAL', `Abandoned: ${reason.slice(0, 80)}`);
  return abandoned;
}

/** Build the <active-goal> prompt section. Returns empty string if no active goal. */
export function buildGoalSection(): string {
  const state = loadGoalState();
  const parts: string[] = [];

  // Active goal
  if (state.active) {
    const g = state.active;
    const phaseLabel = PHASE_LABELS[g.phase] ?? g.phase;
    const currentIdx = PHASE_ORDER.indexOf(g.phase);
    const phaseProgress = PHASE_ORDER.map((p, i) => {
      if (i < currentIdx) return `~~${PHASE_LABELS[p]}~~`;
      if (i === currentIdx) return `**→ ${PHASE_LABELS[p]}**`;
      return PHASE_LABELS[p];
    }).join(' → ');

    const progressSummary = g.progress.length > 0
      ? g.progress.slice(-3).map(p => `- ${p}`).join('\n')
      : '- （剛開始）';

    // 24h stale warning
    const staleWarning = Date.now() - new Date(g.updatedAt).getTime() > 24 * 60 * 60 * 1000
      ? '\n\n⚠️ 這個目標超過 24 小時沒有進展。推進、或用 <kuro:goal-abandon> 放棄。'
      : '';

    parts.push(`<active-goal>
## 正在做：${g.description}
來源：${g.origin} | 階段：${phaseLabel}
${phaseProgress}
進度：
${progressSummary}

繼續推進這個目標。完成當前階段後用 <kuro:goal-advance>回報內容</kuro:goal-advance> 進入下一階段。
完成最後階段用 <kuro:goal-done>摘要</kuro:goal-done>。
要切換目標就用 <kuro:goal>新目標</kuro:goal>。${staleWarning}
</active-goal>`);
  }

  // Queued goals
  if (state.queue.length > 0) {
    const queueList = state.queue.map((q, i) =>
      `${i + 1}. ${q.description} (來源: ${q.origin})`
    ).join('\n');
    parts.push(`<goal-queue>
等待中的目標（按優先度排序）：
${queueList}
用 <kuro:goal-queue>描述</kuro:goal-queue> 加入新目標到清單。
</goal-queue>`);
  }

  return parts.join('\n\n');
}
