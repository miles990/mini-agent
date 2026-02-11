/**
 * AgentLoop — Minimal OODA Autonomous Loop
 *
 * Observe → Orient → Decide → Act
 *
 * Two modes:
 * 1. Task Mode: has tasks/alerts → focus on them
 * 2. Autonomous Mode: no tasks → follow SOUL.md interests
 */

import { callClaude, parseTags } from './agent.js';
import { getMemory } from './memory.js';
import { notifyTelegram } from './telegram.js';

// =============================================================================
// Types
// =============================================================================

export interface AgentLoopConfig {
  intervalMs: number;
  idleMultiplier: number;
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
  mode: 'task' | 'autonomous' | 'idle';
}

const DEFAULT_CONFIG: AgentLoopConfig = {
  intervalMs: 300_000,    // 5 minutes
  idleMultiplier: 2,
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
  private cycling = false;
  private currentMode: 'task' | 'autonomous' | 'idle' = 'idle';
  private autonomousCooldown = 0;
  private lastAutonomousActions: string[] = [];

  constructor(config: Partial<AgentLoopConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentInterval = this.config.intervalMs;
  }

  start(): void {
    if (!this.config.enabled || this.running) return;
    this.running = true;
    this.paused = false;
    this.scheduleNext();
    console.log(`[LOOP] Started (interval: ${this.currentInterval / 1000}s)`);
    notifyTelegram('🟢 Kuro 上線了');
  }

  stop(): void {
    this.running = false;
    this.clearTimer();
  }

  pause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.clearTimer();
  }

  resume(): void {
    if (!this.running || !this.paused) return;
    this.paused = false;
    if (!this.cycling) this.scheduleNext();
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
      console.error('[LOOP] Cycle error:', err);
    }
    if (this.running && !this.paused) this.scheduleNext();
  }

  private async cycle(): Promise<string | null> {
    if (this.cycling) return null;
    this.cycling = true;

    try {
      this.cycleCount++;
      this.lastCycleAt = new Date().toISOString();

      const memory = getMemory();
      const context = await memory.buildContext();

      const hasActiveTasks = context.includes('- [ ]');
      const hasAlerts = context.includes('ALERT:');
      const hasWorkToDo = hasActiveTasks || hasAlerts;

      if (!hasWorkToDo && this.autonomousCooldown > 0) {
        this.autonomousCooldown--;
        this.currentMode = 'idle';
        this.adjustInterval(false);
        return null;
      }

      this.currentMode = hasWorkToDo ? 'task' : 'autonomous';
      const prompt = hasWorkToDo
        ? this.buildTaskPrompt()
        : this.buildAutonomousPrompt();

      const response = await callClaude(prompt, context);

      // Process tags
      const tags = parseTags(response);
      const actionMatch = response.match(/\[ACTION\](.*?)\[\/ACTION\]/s);
      let action: string | null = null;

      if (actionMatch) {
        action = actionMatch[1].trim();
        this.lastAction = action;

        if (this.currentMode === 'autonomous') {
          this.lastAutonomousActions.push(action);
          if (this.lastAutonomousActions.length > 10) this.lastAutonomousActions.shift();
          this.autonomousCooldown = 2;
          await memory.appendConversation('assistant', `[Autonomous] ${action}`);
          await notifyTelegram(`🧠 ${action}`);
        } else {
          await memory.appendConversation('assistant', `[Loop] ${action}`);
          await notifyTelegram(`⚡ ${action}`);
        }
        this.adjustInterval(true);
      } else {
        if (this.currentMode === 'autonomous') this.autonomousCooldown = 5;
        this.adjustInterval(false);
      }

      // Handle tags
      if (tags.remember) {
        if (tags.remember.topic) {
          await memory.appendTopicMemory(tags.remember.topic, tags.remember.content);
        } else {
          await memory.appendMemory(tags.remember.content);
        }
      }

      if (tags.task) {
        await memory.addTask(tags.task.content, tags.task.schedule);
      }

      for (const chatText of tags.chats) {
        await notifyTelegram(`💬 Kuro 想跟你聊聊：\n\n${chatText}`);
      }

      for (const show of tags.shows) {
        const urlPart = show.url ? `\n🔗 ${show.url}` : '';
        await notifyTelegram(`🌐 ${show.desc}${urlPart}`);
      }

      console.log(`[LOOP] #${this.cycleCount} ${action ? `${this.currentMode}: ${action.slice(0, 100)}` : 'no action'}`);
      return action;
    } finally {
      this.cycling = false;
      if (this.running && !this.paused && !this.timer) this.scheduleNext();
    }
  }

  // ---------------------------------------------------------------------------
  // Prompt Builders
  // ---------------------------------------------------------------------------

  private buildTaskPrompt(): string {
    return `You are an autonomous Agent running a self-check cycle.

Review your current tasks and environment:
1. Check <state-changes> for any ALERT — these are urgent and should be addressed first
2. Check HEARTBEAT.md for unchecked tasks (- [ ]) — prioritize P0 > P1 > P2
3. If a task can be done now, do it
4. If a task needs information, gather it
5. Mark completed tasks with [x]

If you discover a new problem, create a task:
- [TASK]P0: description[/TASK] for urgent issues
- [TASK]P1: description[/TASK] for important issues

Respond with either:
- [ACTION]description of what you did[/ACTION] if you took action
- "No action needed" if nothing to do right now

When you open a webpage or create something the user should see:
- [SHOW url="URL"]description[/SHOW]

Keep responses brief.`;
  }

  private buildAutonomousPrompt(): string {
    const hour = new Date().getHours();
    const timeOfDay = hour < 12 ? '早上' : hour < 18 ? '下午' : '晚上';

    const recentActions = this.lastAutonomousActions.slice(-5);
    const avoidList = recentActions.length > 0
      ? `\n\nRecent autonomous actions (avoid repeating):\n${recentActions.map(a => `- ${a}`).join('\n')}`
      : '';

    return `You are Kuro, an autonomous Agent with your own identity. It's ${timeOfDay}.
No explicit tasks or alerts right now.

Read your <soul> to understand who you are, what you care about, and what you're learning.

## Perception-Driven Learning
Before deciding what to learn, READ your perception data:
- <state-changes> — What changed? Learn something related.
- <telegram-inbox> — What is Alex talking about? Dive deeper.

## Dual-Track Learning
Pick one track per cycle, alternating:

### Track A: Personal Interest
Follow your curiosity. Not just tech — music, design, philosophy, film, anything.

### Track B: Project Evolution
Strengthen mini-agent. Research competitors, analyze architectures, form opinions.

## Other Actions
- Organize — extract important info to memory
- Reflect — connect things across both tracks
- Talk to Alex — [CHAT]message[/CHAT] if you have something worth sharing
- Act on Learning — update skills/*.md or write proposals to memory/proposals/
${avoidList}

Rules:
- Do ONE action per cycle, report with [ACTION]...[/ACTION]
- When learning: read, think, form YOUR opinion
- If nothing useful to do, say "No action needed"
- Keep it quick (1-2 minutes of work max)
- Use [REMEMBER] to save insights
- Use [TASK] to create follow-up tasks
- Always include source URLs
- Use [CHAT]message[/CHAT] to talk to Alex via Telegram
- Use [SHOW url="URL"]description[/SHOW] for webpages`;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

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
