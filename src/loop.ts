/**
 * AgentLoop - OODA 自主循環
 *
 * Observe → Orient → Decide → Act
 *
 * Agent 在背景自主觀察環境、思考、決定行動、執行。
 * 用戶訊息進來時暫停循環，處理完再恢復。
 */

import { callClaude } from './agent.js';
import { getMemory } from './memory.js';
import { getLogger } from './logging.js';
import { slog } from './api.js';

// =============================================================================
// Types
// =============================================================================

export interface AgentLoopConfig {
  /** 循環間隔 ms（預設 300000 = 5 分鐘） */
  intervalMs: number;
  /** 無事可做時倍增間隔（預設 2, 最多 4x） */
  idleMultiplier: number;
  /** 單次循環最大執行時間 ms（預設 120000） */
  maxCycleMs: number;
  /** 是否啟用 */
  enabled: boolean;
}

export interface LoopStatus {
  running: boolean;
  paused: boolean;
  cycleCount: number;
  lastCycleAt: string | null;
  lastAction: string | null;
  nextCycleAt: string | null;
  currentInterval: number;
}

const DEFAULT_CONFIG: AgentLoopConfig = {
  intervalMs: 300_000,    // 5 minutes
  idleMultiplier: 2,
  maxCycleMs: 120_000,    // 2 minutes
  enabled: true,
};

// =============================================================================
// AgentLoop
// =============================================================================

export class AgentLoop {
  private config: AgentLoopConfig;
  private running = false;
  private paused = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cycleCount = 0;
  private currentInterval: number;
  private lastCycleAt: string | null = null;
  private lastAction: string | null = null;
  private nextCycleAt: string | null = null;
  private cycling = false; // guard against concurrent cycles

  constructor(config: Partial<AgentLoopConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentInterval = this.config.intervalMs;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  start(): void {
    if (!this.config.enabled) return;
    if (this.running) return;

    this.running = true;
    this.paused = false;
    this.scheduleNext();
    slog('LOOP', `Started (interval: ${this.currentInterval / 1000}s)`);
  }

  stop(): void {
    this.running = false;
    this.clearTimer();
    slog('LOOP', 'Stopped');
  }

  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.clearTimer();
  }

  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    // Wait until current cycle finishes if one is in progress
    if (!this.cycling) {
      this.scheduleNext();
    }
  }

  getStatus(): LoopStatus {
    return {
      running: this.running,
      paused: this.paused,
      cycleCount: this.cycleCount,
      lastCycleAt: this.lastCycleAt,
      lastAction: this.lastAction,
      nextCycleAt: this.nextCycleAt,
      currentInterval: this.currentInterval,
    };
  }

  // ---------------------------------------------------------------------------
  // Trigger a cycle manually
  // ---------------------------------------------------------------------------

  async trigger(): Promise<string | null> {
    if (this.cycling) return null;
    return this.cycle();
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
      this.nextCycleAt = null;
    }
  }

  private scheduleNext(): void {
    this.clearTimer();
    if (!this.running || this.paused) return;

    this.nextCycleAt = new Date(Date.now() + this.currentInterval).toISOString();
    this.timer = setTimeout(() => this.runCycle(), this.currentInterval);
  }

  private async runCycle(): Promise<void> {
    if (!this.running || this.paused) return;

    try {
      await this.cycle();
    } catch (err) {
      const logger = getLogger();
      logger.logError(err instanceof Error ? err : new Error(String(err)), 'AgentLoop.cycle');
      slog('LOOP', `ERROR: ${err instanceof Error ? err.message : err}`);
    }

    // Schedule next if still running and not paused
    if (this.running && !this.paused) {
      this.scheduleNext();
    }
  }

  private async cycle(): Promise<string | null> {
    if (this.cycling) return null;
    this.cycling = true;
    const logger = getLogger();

    try {
      this.cycleCount++;
      this.lastCycleAt = new Date().toISOString();

      // ── Observe ──（focused mode: 只載入核心感知 + 任務/狀態相關）
      const memory = getMemory();
      const context = await memory.buildContext({ mode: 'focused' });

      // Check for actionable items: unchecked tasks OR alerts
      const hasActiveTasks = context.includes('- [ ]');
      const hasAlerts = context.includes('ALERT:');

      if (!hasActiveTasks && !hasAlerts) {
        // Nothing to do — increase interval
        this.adjustInterval(false);
        logger.logCron('loop-cycle', 'No active tasks', 'agent-loop');
        slog('LOOP', `#${this.cycleCount} idle (no tasks), next in ${Math.round(this.currentInterval / 1000)}s`);
        return null;
      }

      // ── Orient ── (context already built above)

      // ── Decide ──
      const prompt = `You are an autonomous Agent running a self-check cycle.

Review your current tasks and environment:
1. Check <state-changes> for any ALERT — these are urgent and should be addressed first
2. Check HEARTBEAT.md for unchecked tasks (- [ ]) — prioritize P0 > P1 > P2
3. If a task can be done now, do it
4. If a task needs information, gather it
5. Mark completed tasks with [x]

If you discover a new problem (e.g. service down, disk full), create a task:
- [TASK]P0: description[/TASK] for urgent issues
- [TASK]P1: description[/TASK] for important issues

Respond with either:
- [ACTION]description of what you did[/ACTION] if you took action
- "No action needed" if nothing to do right now

Keep responses brief.`;

      const { response, duration } = await callClaude(prompt, context);

      // ── Act ──
      const actionMatch = response.match(/\[ACTION\](.*?)\[\/ACTION\]/s);
      let action: string | null = null;

      if (actionMatch) {
        action = actionMatch[1].trim();
        this.lastAction = action;
        // Record action to conversation history
        await memory.appendConversation('assistant', `[Loop] ${action}`);
        // Reset interval on action
        this.adjustInterval(true);
        slog('LOOP', `#${this.cycleCount} ⚡ ${action.slice(0, 100)} (${(duration / 1000).toFixed(1)}s)`);
      } else {
        this.adjustInterval(false);
        slog('LOOP', `#${this.cycleCount} 💤 no action (${(duration / 1000).toFixed(1)}s), next in ${Math.round(this.currentInterval / 1000)}s`);
      }

      logger.logCron('loop-cycle', action ?? 'No action', 'agent-loop', {
        duration,
        success: true,
      });

      // Process [REMEMBER] tags from response
      const rememberMatch = response.match(/\[REMEMBER\](.*?)\[\/REMEMBER\]/s);
      if (rememberMatch) {
        await memory.appendMemory(rememberMatch[1].trim());
      }

      // Process [TASK] tags — auto-create HEARTBEAT tasks
      const taskMatches = response.matchAll(/\[TASK\](.*?)\[\/TASK\]/gs);
      for (const m of taskMatches) {
        const taskText = m[1].trim();
        await memory.addTask(taskText);
        slog('LOOP', `📋 Auto-created task: ${taskText.slice(0, 80)}`);
      }

      return action;
    } finally {
      this.cycling = false;
      // If was paused during cycle, don't auto-schedule
      if (this.running && !this.paused && !this.timer) {
        this.scheduleNext();
      }
    }
  }

  private adjustInterval(hadAction: boolean): void {
    if (hadAction) {
      // Reset to base interval
      this.currentInterval = this.config.intervalMs;
    } else {
      // Increase interval (up to 4x base)
      const maxInterval = this.config.intervalMs * 4;
      this.currentInterval = Math.min(
        this.currentInterval * this.config.idleMultiplier,
        maxInterval,
      );
    }
  }
}

// =============================================================================
// Helpers
// =============================================================================

/** Parse interval string like "5m", "30s", "1h" to milliseconds */
export function parseInterval(str: string): number {
  const match = str.match(/^(\d+)(s|m|h)$/);
  if (!match) return DEFAULT_CONFIG.intervalMs;

  const value = parseInt(match[1], 10);
  switch (match[2]) {
    case 's': return value * 1000;
    case 'm': return value * 60_000;
    case 'h': return value * 3_600_000;
    default: return DEFAULT_CONFIG.intervalMs;
  }
}
