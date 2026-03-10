/**
 * Goal State — 跨 cycle 的目標鎖定機制
 *
 * 感知不停，目標不散。Goal 疊加在 perception 之上，
 * 讓 Kuro 能持續推進目標，不被環境安靜沖散。
 */

import fs from 'node:fs';
import path from 'node:path';
import { getMemoryStateDir } from './memory.js';
import { slog } from './utils.js';

export interface ActiveGoal {
  id: string;
  description: string;
  origin: string;
  steps: string[];
  progress: string[];
  status: 'active' | 'completed' | 'superseded' | 'abandoned';
  createdAt: string;
  updatedAt: string;
  supersededBy?: string;
}

interface GoalState {
  active: ActiveGoal | null;
  history: ActiveGoal[];
}

const HISTORY_LIMIT = 5;

function getGoalStatePath(): string {
  return path.join(getMemoryStateDir(), 'goal-state.json');
}

export function loadGoalState(): GoalState {
  try {
    const data = fs.readFileSync(getGoalStatePath(), 'utf-8');
    return JSON.parse(data) as GoalState;
  } catch {
    return { active: null, history: [] };
  }
}

function saveGoalState(state: GoalState): void {
  fs.writeFileSync(getGoalStatePath(), JSON.stringify(state, null, 2), 'utf-8');
}

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
    steps: [],
    progress: [],
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };

  state.active = goal;
  saveGoalState(state);
  slog('GOAL', `Created: ${description.slice(0, 80)}`);
  return goal;
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
  if (!state.active) return '';

  const g = state.active;
  const progressSummary = g.progress.length > 0
    ? g.progress.slice(-3).map(p => `- ${p}`).join('\n')
    : '- （剛開始）';

  // 24h stale warning
  const staleWarning = Date.now() - new Date(g.updatedAt).getTime() > 24 * 60 * 60 * 1000
    ? '\n\n⚠️ 這個目標超過 24 小時沒有進展。考慮推進、或用 <kuro:goal-abandon> 明確放棄。'
    : '';

  return `<active-goal>
## 你正在做：${g.description}
來源：${g.origin}
進度：
${progressSummary}

繼續推進這個目標。感知信號供參考 — 除非發現比這更重要的事。
用 <kuro:goal-progress>做了什麼</kuro:goal-progress> 記錄進展。
完成時用 <kuro:goal-done>摘要</kuro:goal-done>。
要切換目標就直接用 <kuro:goal>新目標</kuro:goal>。${staleWarning}
</active-goal>`;
}
