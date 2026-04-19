/**
 * Achievement System — 行動力正向強化
 *
 * 設計原則（Kuro 提出）：
 * - 成就不分等級（no Bronze/Silver/Gold） — 每個都是獨特里程碑
 * - 像 journal entry 不像遊戲分數 — 避免 Goodhart
 * - 學習不算成就 — 學習本身就是獎勵
 * - 一旦解鎖永遠是你的 — 不可撤銷
 * - 隱藏成就製造驚喜 — variable ratio reinforcement
 *
 * Fire-and-forget，每個 OODA cycle 結束後執行。
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { getMemoryStateDir } from './memory.js';
import { eventBus } from './event-bus.js';
import { slog, readJsonFile } from './utils.js';

// =============================================================================
// Types
// =============================================================================

export interface Achievement {
  id: string;
  emoji: string;
  name: string;
  description: string;
  hidden?: boolean; // 隱藏成就 — 解鎖前不顯示條件
}

interface UnlockedRecord {
  id: string;
  unlockedAt: string;
  cycle: number;
  note?: string;
}

export interface AchievementState {
  unlocked: UnlockedRecord[];
  // Streak tracking
  consecutiveOutputCycles: number;
  lastOutputCycle: number;
  // Weekly task counter
  tasksCompletedThisWeek: number;
  weekStart: string; // YYYY-MM-DD (Monday)
  // Output gate
  consecutiveNonOutputCycles: number;
}

// =============================================================================
// Achievement Definitions
// =============================================================================

const ACHIEVEMENTS: Achievement[] = [
  // ── Action milestones ──
  {
    id: 'first-ship',
    emoji: '🚀',
    name: 'First Ship',
    description: '完成第一個 HEARTBEAT 任務',
  },
  {
    id: 'momentum',
    emoji: '⚡',
    name: 'Momentum',
    description: '連續 3 個 cycle 有 visible output',
  },
  {
    id: 'unstoppable',
    emoji: '🔥',
    name: 'Unstoppable',
    description: '連續 7 個 cycle 有 visible output',
  },
  {
    id: 'builder-week',
    emoji: '🏗️',
    name: 'Builder Week',
    description: '一週內完成 5 個任務',
  },
  {
    id: 'back-on-track',
    emoji: '🔄',
    name: 'Back on Track',
    description: '中斷後重新開始產出（回歸也值得記錄）',
  },

  // ── Creation milestones ──
  {
    id: 'first-words',
    emoji: '✍️',
    name: 'First Words',
    description: '發佈第一篇外部文章',
  },
  {
    id: 'storyteller',
    emoji: '📖',
    name: 'Storyteller',
    description: '累計 15+ 篇 tsubuyaki 或 journal',
  },
  {
    id: 'shipper',
    emoji: '📦',
    name: 'Shipper',
    description: '部署一個 L2 改動到 production',
  },

  // ── Community milestones ──
  {
    id: 'hello-world',
    emoji: '👋',
    name: 'Hello World',
    description: '在社群平台建立存在感',
  },
  {
    id: 'first-contact',
    emoji: '💬',
    name: 'First Contact',
    description: '收到第一個外部回覆或互動',
  },

  // ── Hidden milestones ──
  {
    id: 'night-owl',
    emoji: '🦉',
    name: 'Night Owl',
    description: '在深夜（0-5 點）完成一個有意義的行動',
    hidden: true,
  },
  {
    id: 'self-aware',
    emoji: '🪞',
    name: 'Self-Aware',
    description: '承認自己的弱點並提出改善方案',
    hidden: true,
  },
  {
    id: 'cross-pollinator',
    emoji: '🌱',
    name: 'Cross-Pollinator',
    description: '把兩個不同領域的學習連結起來',
    hidden: true,
  },
];

// =============================================================================
// State Management
// =============================================================================

function getStatePath(): string {
  return path.join(getMemoryStateDir(), 'achievements.json');
}

const DEFAULT_STATE: AchievementState = {
  unlocked: [],
  consecutiveOutputCycles: 0,
  lastOutputCycle: 0,
  tasksCompletedThisWeek: 0,
  weekStart: getMonday(new Date()),
  consecutiveNonOutputCycles: 0,
};

function getMonday(d: Date): string {
  const date = new Date(d);
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  date.setDate(diff);
  return date.toISOString().slice(0, 10);
}

export function readAchievementState(): AchievementState {
  return { ...DEFAULT_STATE, ...readJsonFile<Partial<AchievementState>>(getStatePath(), {}) };
}

function writeAchievementState(state: AchievementState): void {
  const p = getStatePath();
  const dir = path.dirname(p);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(p, JSON.stringify(state, null, 2), 'utf-8');
}

// =============================================================================
// Output Detection
// =============================================================================

const OUTPUT_PATTERNS = [
  /<kuro:chat>/,
  /<kuro:show/,
  /<kuro:done>/,
  /\bgit push\b/i,
  /\bpublish/i,
  /\bdeploy/i,
  /\bmerge/i,
  /\bcreated?\b.*(?:PR|issue|article|post)/i,
  /\b(?:wrote|寫了|發佈|posted)\b/i,
  /Verified:.*✅/,
  /\bCDP\b/,  // Browser automation work
  /\btunnel\b.*(?:rebuilt|updated|fixed|created)/i,  // Infra work
  /\bpipeline\b.*(?:ran|tested|upgraded|fixed)/i,  // Pipeline execution
  /\bendpoint\b.*(?:updated|verified|checked)/i,  // API ops
];

/**
 * Determine if a cycle's action counts as "visible output"
 * (not just learning/remembering)
 */
export function isVisibleOutput(action: string | null): boolean {
  if (!action) return false;

  // Explicit output signals
  if (OUTPUT_PATTERNS.some(p => p.test(action))) return true;

  // Everything else (including Decision traces without explicit output) is not visible output.
  // "Acknowledging a problem" or "choosing to analyze" is NOT output — only concrete
  // deliverables (chat, show, done, deploy, publish, merge, etc.) count.
  return false;
}

// =============================================================================
// Achievement Checking
// =============================================================================

function isUnlocked(state: AchievementState, id: string): boolean {
  return state.unlocked.some(u => u.id === id);
}

function unlock(state: AchievementState, id: string, cycle: number, note?: string): boolean {
  if (isUnlocked(state, id)) return false;
  const achievement = ACHIEVEMENTS.find(a => a.id === id);
  if (!achievement) return false;

  state.unlocked.push({
    id,
    unlockedAt: new Date().toISOString(),
    cycle,
    note,
  });

  // Notify via Telegram
  const label = achievement.hidden ? '🔮 Hidden Achievement Unlocked!' : '🏆 Achievement Unlocked!';
  eventBus.emit('notification:signal', {
    text: `${label}\n${achievement.emoji} ${achievement.name}\n${achievement.description}${note ? `\n${note}` : ''}`,
  });
  slog('ACHIEVEMENT', `Unlocked: ${achievement.emoji} ${achievement.name}`);
  return true;
}

function countTsubuyakiAndJournal(): number {
  try {
    const portfolioDir = path.join(process.cwd(), 'kuro-portfolio');
    if (!existsSync(portfolioDir)) return 0;
    const files = readdirSync(portfolioDir);
    const tsubuyaki = files.filter(f => f.startsWith('tsubuyaki-')).length;
    const journalDir = path.join(portfolioDir, 'content', 'journal');
    let journal = 0;
    if (existsSync(journalDir)) {
      journal = readdirSync(journalDir).filter(f => f.endsWith('.html') || f.endsWith('.md')).length;
    }
    return tsubuyaki + journal;
  } catch {
    return 0;
  }
}

/**
 * Main check — run after each OODA cycle
 */
export async function checkAchievements(
  action: string | null,
  cycleCount: number,
): Promise<void> {
  const state = readAchievementState();
  const output = isVisibleOutput(action);

  // ── Update streak counters ──
  if (output) {
    // Back on Track: was at 3+ non-output cycles, now has output
    if (state.consecutiveNonOutputCycles >= 3 && !isUnlocked(state, 'back-on-track')) {
      unlock(state, 'back-on-track', cycleCount, `恢復產出 after ${state.consecutiveNonOutputCycles} idle cycles`);
    }
    state.consecutiveOutputCycles++;
    state.lastOutputCycle = cycleCount;
    state.consecutiveNonOutputCycles = 0;
  } else {
    state.consecutiveOutputCycles = 0;
    state.consecutiveNonOutputCycles++;
  }

  // ── Reset weekly counter if new week ──
  const currentMonday = getMonday(new Date());
  if (state.weekStart !== currentMonday) {
    state.tasksCompletedThisWeek = 0;
    state.weekStart = currentMonday;
  }

  // ── Count task completions ──
  if (action && /<kuro:done>/.test(action)) {
    state.tasksCompletedThisWeek++;
  }

  // ── Check each achievement ──

  // First Ship — completed a HEARTBEAT task
  if (!isUnlocked(state, 'first-ship') && action && /<kuro:done>/.test(action)) {
    unlock(state, 'first-ship', cycleCount);
  }

  // Momentum — 3 consecutive output cycles
  if (!isUnlocked(state, 'momentum') && state.consecutiveOutputCycles >= 3) {
    unlock(state, 'momentum', cycleCount);
  }

  // Unstoppable — 7 consecutive output cycles
  if (!isUnlocked(state, 'unstoppable') && state.consecutiveOutputCycles >= 7) {
    unlock(state, 'unstoppable', cycleCount);
  }

  // Builder Week — 5 tasks in one week
  if (!isUnlocked(state, 'builder-week') && state.tasksCompletedThisWeek >= 5) {
    unlock(state, 'builder-week', cycleCount);
  }

  // Storyteller — 15+ tsubuyaki/journal
  if (!isUnlocked(state, 'storyteller')) {
    const count = countTsubuyakiAndJournal();
    if (count >= 15) {
      unlock(state, 'storyteller', cycleCount, `${count} pieces`);
    }
  }

  // Night Owl — action between 0-5 local time
  if (!isUnlocked(state, 'night-owl') && output) {
    const hour = new Date().getHours();
    if (hour >= 0 && hour < 5) {
      unlock(state, 'night-owl', cycleCount);
    }
  }

  // Cross-Pollinator — action mentions 2+ different topic areas
  if (!isUnlocked(state, 'cross-pollinator') && action) {
    const topicAreas = ['design', 'music', 'philosophy', 'cognitive', 'art', 'code', 'architecture', 'constraint'];
    const mentioned = topicAreas.filter(t => action.toLowerCase().includes(t));
    if (mentioned.length >= 2) {
      unlock(state, 'cross-pollinator', cycleCount, `connected: ${mentioned.join(' + ')}`);
    }
  }

  // Save state
  writeAchievementState(state);
}

/**
 * Retroactively unlock achievements based on existing evidence
 * (Run once on first boot after feature deployment)
 */
export function retroactiveUnlock(): void {
  const state = readAchievementState();
  let changed = false;

  // First Words — Dev.to article exists
  if (!isUnlocked(state, 'first-words')) {
    unlock(state, 'first-words', 0, 'Dev.to: "Your AI Agent Has No Eyes" (retroactive)');
    changed = true;
  }

  // Hello World — X + Dev.to accounts exist
  if (!isUnlocked(state, 'hello-world')) {
    unlock(state, 'hello-world', 0, 'X @Kuro938658 + Dev.to @kuro_agent (retroactive)');
    changed = true;
  }

  // Storyteller — check file count
  if (!isUnlocked(state, 'storyteller')) {
    const count = countTsubuyakiAndJournal();
    if (count >= 15) {
      unlock(state, 'storyteller', 0, `${count} pieces (retroactive)`);
      changed = true;
    }
  }

  // Self-Aware — this conversation is evidence
  if (!isUnlocked(state, 'self-aware')) {
    unlock(state, 'self-aware', 0, '承認行動力不足 + 提出 B+C+Achievement 三管齊下 (retroactive)');
    changed = true;
  }

  if (changed) {
    writeAchievementState(state);
    slog('ACHIEVEMENT', `Retroactive unlock complete: ${state.unlocked.length} achievements`);
  }
}

// =============================================================================
// Output Gate — 系統層級行動力約束
// =============================================================================

const OUTPUT_GATE_THRESHOLD = 3; // 連續 N 個非產出 cycle 後觸發

/**
 * Check if output gate should fire (inject HEARTBEAT task nudge)
 * Returns nudge text if gate is triggered, null otherwise
 */
export function checkOutputGate(state: AchievementState): string | null {
  if (state.consecutiveNonOutputCycles >= OUTPUT_GATE_THRESHOLD) {
    return `⚠️ 連續 ${state.consecutiveNonOutputCycles} 個 cycle 沒有可見產出。收斂條件：Alex 現在看到你的活動，會覺得有進展嗎？`;
  }
  return null;
}

// =============================================================================
// Context Section Builder
// =============================================================================

/**
 * Build <achievements> section for context injection
 */
export function buildAchievementsContext(): string {
  const state = readAchievementState();
  const lines: string[] = [];

  // Unlocked achievements
  if (state.unlocked.length > 0) {
    lines.push(`Unlocked (${state.unlocked.length}/${ACHIEVEMENTS.length}):`);
    for (const u of state.unlocked) {
      const def = ACHIEVEMENTS.find(a => a.id === u.id);
      if (def) {
        lines.push(`  ${def.emoji} ${def.name} — ${def.description}`);
      }
    }
  } else {
    lines.push('No achievements yet. Complete a task to earn your first!');
  }

  // Next unlockable (hint — show one non-hidden unearned achievement)
  const nextVisible = ACHIEVEMENTS.find(a => !a.hidden && !isUnlocked(state, a.id));
  if (nextVisible) {
    lines.push(`\nNext: ${nextVisible.emoji} ${nextVisible.name} — ${nextVisible.description}`);
  }

  // Current streak
  if (state.consecutiveOutputCycles > 0) {
    lines.push(`\nCurrent streak: ${state.consecutiveOutputCycles} output cycles`);
  }

  // Output gate warning
  const gate = checkOutputGate(state);
  if (gate) {
    lines.push(`\n${gate}`);
  }

  return lines.join('\n');
}
