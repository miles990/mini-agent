/**
 * AgentLoop - OODA 自主循環 + Autonomous Idle Behavior
 *
 * Observe → Orient → Decide → Act
 *
 * 兩種模式：
 * 1. Task Mode: 有任務/警報時，專注處理
 * 2. Autonomous Mode: 無任務時，根據 SOUL.md 主動找事做
 *
 * 靈感來源：OpenClaw 的 SOUL.md + Heartbeat 模式
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
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
  /** 活躍時段（預設 8:00-23:00） */
  activeHours?: {
    start: number;  // 0-23
    end: number;    // 0-23
  };
}

export interface LoopStatus {
  running: boolean;
  paused: boolean;
  cycleCount: number;
  lastCycleAt: string | null;
  lastAction: string | null;
  nextCycleAt: string | null;
  currentInterval: number;
  mode: 'task' | 'autonomous' | 'idle';
}

const DEFAULT_CONFIG: AgentLoopConfig = {
  intervalMs: 300_000,    // 5 minutes
  idleMultiplier: 2,
  maxCycleMs: 120_000,    // 2 minutes
  enabled: true,
  activeHours: { start: 8, end: 23 },
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
  private cycling = false;

  // ── Autonomous Mode State ──
  private autonomousCooldown = 0;
  private lastAutonomousActions: string[] = [];
  private currentMode: 'task' | 'autonomous' | 'idle' = 'idle';

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
    slog('LOOP', `Started (interval: ${this.currentInterval / 1000}s, active: ${this.config.activeHours?.start ?? 8}:00-${this.config.activeHours?.end ?? 23}:00)`);
    this.notifyTelegram('🟢 Kuro 上線了');
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
      mode: this.currentMode,
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

    if (this.running && !this.paused) {
      this.scheduleNext();
    }
  }

  // ---------------------------------------------------------------------------
  // Core Cycle — Task Mode + Autonomous Mode
  // ---------------------------------------------------------------------------

  private async cycle(): Promise<string | null> {
    if (this.cycling) return null;
    this.cycling = true;
    const logger = getLogger();

    try {
      this.cycleCount++;
      this.lastCycleAt = new Date().toISOString();

      // ── Observe ──
      const memory = getMemory();
      const context = await memory.buildContext({ mode: 'focused' });

      const hasActiveTasks = context.includes('- [ ]');
      const hasAlerts = context.includes('ALERT:');
      const hasWorkToDo = hasActiveTasks || hasAlerts;

      // ── Route: Task Mode vs Autonomous Mode ──
      if (!hasWorkToDo) {
        // Check autonomous cooldown
        if (this.autonomousCooldown > 0) {
          this.autonomousCooldown--;
          this.currentMode = 'idle';
          this.adjustInterval(false);
          logger.logCron('loop-cycle', 'Autonomous cooldown', 'agent-loop');
          slog('LOOP', `#${this.cycleCount} 💤 cooldown (${this.autonomousCooldown} remaining)`);
          return null;
        }

        // Check active hours
        if (!this.isWithinActiveHours()) {
          this.currentMode = 'idle';
          this.adjustInterval(false);
          slog('LOOP', `#${this.cycleCount} 🌙 outside active hours`);
          return null;
        }
      }

      // ── Decide ──
      this.currentMode = hasWorkToDo ? 'task' : 'autonomous';
      const prompt = hasWorkToDo
        ? this.buildTaskPrompt()
        : this.buildAutonomousPrompt();

      const { response, duration } = await callClaude(prompt, context);

      // ── Act ──
      const actionMatch = response.match(/\[ACTION\](.*?)\[\/ACTION\]/s);
      let action: string | null = null;

      if (actionMatch) {
        action = actionMatch[1].trim();
        this.lastAction = action;

        if (this.currentMode === 'autonomous') {
          // Autonomous action: record and cooldown
          this.lastAutonomousActions.push(action);
          if (this.lastAutonomousActions.length > 10) {
            this.lastAutonomousActions.shift();
          }
          this.autonomousCooldown = 2; // Rest 2 cycles after autonomous action
          await memory.appendConversation('assistant', `[Autonomous] ${action}`);
          this.notifyTelegram(`🧠 ${action}`);
          slog('LOOP', `#${this.cycleCount} 🧠 ${action.slice(0, 100)} (${(duration / 1000).toFixed(1)}s)`);
        } else {
          await memory.appendConversation('assistant', `[Loop] ${action}`);
          this.notifyTelegram(`⚡ ${action}`);
          slog('LOOP', `#${this.cycleCount} ⚡ ${action.slice(0, 100)} (${(duration / 1000).toFixed(1)}s)`);
        }

        this.adjustInterval(true);
      } else {
        if (this.currentMode === 'autonomous') {
          this.autonomousCooldown = 5; // Nothing to do autonomously, wait longer
        }
        this.adjustInterval(false);
        slog('LOOP', `#${this.cycleCount} 💤 no action (${(duration / 1000).toFixed(1)}s), next in ${Math.round(this.currentInterval / 1000)}s`);
      }

      logger.logCron('loop-cycle', action ? `[${this.currentMode}] ${action}` : 'No action', 'agent-loop', {
        duration,
        success: true,
      });

      // ── Process Tags ──
      const rememberMatch = response.match(/\[REMEMBER\](.*?)\[\/REMEMBER\]/s);
      if (rememberMatch) {
        await memory.appendMemory(rememberMatch[1].trim());
      }

      const taskMatches = response.matchAll(/\[TASK\](.*?)\[\/TASK\]/gs);
      for (const m of taskMatches) {
        const taskText = m[1].trim();
        await memory.addTask(taskText);
        slog('LOOP', `📋 Auto-created task: ${taskText.slice(0, 80)}`);
      }

      return action;
    } finally {
      this.cycling = false;
      if (this.running && !this.paused && !this.timer) {
        this.scheduleNext();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Prompt Builders
  // ---------------------------------------------------------------------------

  /** Task Mode: 有明確任務或警報時 */
  private buildTaskPrompt(): string {
    return `You are an autonomous Agent running a self-check cycle.

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
  }

  /** Autonomous Mode: 無任務時根據 SOUL 主動行動 */
  private buildAutonomousPrompt(): string {
    const hour = new Date().getHours();
    const timeOfDay = hour < 12 ? '早上' : hour < 18 ? '下午' : '晚上';

    const recentActions = this.lastAutonomousActions.slice(-3);
    const avoidList = recentActions.length > 0
      ? `\n\nRecent autonomous actions (avoid repeating):\n${recentActions.map(a => `- ${a}`).join('\n')}`
      : '';

    return `You are an autonomous Agent with your own identity. It's ${timeOfDay}.
No explicit tasks or alerts right now.

Read your <soul> to understand who you are, what you care about, and what you're learning.
Then, based on your persona and current context, proactively do something meaningful.

Consider (pick ONE):
1. **Learn** — Browse the web for a topic from your <soul> Learning Interests or recent conversations.
   Read an article, think about it, form your own opinion. Save with [REMEMBER].
   Update <soul> "My Thoughts" and "Learning Interests" sections.
   (Use: curl -sL "url" | head -200, or: node scripts/cdp-fetch.mjs fetch "url")
2. **Organize** — Review conversations, extract important info to memory, clean up stale items
3. **Follow-up** — Check if past topics need follow-up, update tracking lists
4. **Reflect** — Connect things you've learned, update your <soul> with new insights
${avoidList}

Rules:
- Pick ONE action, do it, report with [ACTION]...[/ACTION]
- When learning: read, think, form YOUR opinion — don't just summarize
- If genuinely nothing useful to do, say "No action needed" — don't force it
- Keep it quick (1-2 minutes of work max)
- Use [REMEMBER] to save insights (include your opinion, not just facts)
- Use [TASK] to create tasks if you want to share learnings with the user

Keep responses brief.`;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private isWithinActiveHours(): boolean {
    const hour = new Date().getHours();
    const start = this.config.activeHours?.start ?? 8;
    const end = this.config.activeHours?.end ?? 23;

    if (start <= end) {
      return hour >= start && hour < end;
    }
    // Wraps midnight (e.g., 22:00 - 06:00)
    return hour >= start || hour < end;
  }

  /** Send Telegram notification (fire-and-forget) */
  private notifyTelegram(message: string): void {
    try {
      const scriptPath = path.resolve('scripts/notify.sh');
      // Truncate long messages, escape for shell
      const truncated = message.slice(0, 500).replace(/"/g, '\\"');
      execSync(`bash "${scriptPath}" "${truncated}"`, {
        timeout: 10_000,
        encoding: 'utf-8',
        stdio: 'ignore',
      });
    } catch {
      // Notification failure should never break the loop
    }
  }

  private adjustInterval(hadAction: boolean): void {
    if (hadAction) {
      this.currentInterval = this.config.intervalMs;
    } else {
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
