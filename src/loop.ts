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

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { callClaude, hasQueuedMessages, drainQueue } from './agent.js';
import { getMemory } from './memory.js';
import { getLogger } from './logging.js';
import { diagLog, slog } from './utils.js';
import { parseTags } from './dispatcher.js';
import { eventBus } from './event-bus.js';
import type { AgentEvent } from './event-bus.js';
import { perceptionStreams } from './perception-stream.js';
import { getCurrentInstanceId, getInstanceDir } from './instance.js';
import {
  updateTemporalState, buildThreadsPromptSection,
  startThread, progressThread, completeThread, pauseThread,
} from './temporal.js';

const execFileAsync = promisify(execFile);

// =============================================================================
// Cycle Checkpoint (Phase 1c)
// =============================================================================

interface CycleCheckpoint {
  startedAt: string;
  mode: 'task' | 'autonomous' | 'idle';
  triggerReason: string | null;
  promptSnippet: string;
  partialOutput: string | null;
  lastAction: string | null;
  lastAutonomousActions: string[];
}

function getCycleCheckpointPath(): string | null {
  try {
    const instanceId = getCurrentInstanceId();
    if (!instanceId) return null;
    return path.join(getInstanceDir(instanceId), 'cycle-state.json');
  } catch { return null; }
}

function saveCycleCheckpoint(data: CycleCheckpoint): void {
  const filePath = getCycleCheckpointPath();
  if (!filePath) return;
  try {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data), 'utf-8');
  } catch { /* fire-and-forget */ }
}

function clearCycleCheckpoint(): void {
  const filePath = getCycleCheckpointPath();
  if (!filePath) return;
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch { /* fire-and-forget */ }
}

function loadStaleCheckpoint(): { info: string; lastAction: string | null; lastAutonomousActions: string[] } | null {
  const filePath = getCycleCheckpointPath();
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as CycleCheckpoint;

    // 只恢復 1h 內的 checkpoint
    const age = Date.now() - new Date(data.startedAt).getTime();
    if (age > 3_600_000) {
      slog('RESUME', 'Stale checkpoint found but too old (>1h), ignoring');
      fs.unlinkSync(filePath);
      return null;
    }

    const partial = data.partialOutput ? ` Partial output: ${data.partialOutput.slice(0, 200)}` : '';
    const info = `Mode: ${data.mode}, Trigger: ${data.triggerReason ?? 'unknown'}, Prompt: ${data.promptSnippet}${partial}`;

    slog('RESUME', `Detected interrupted cycle from ${data.startedAt}`);
    fs.unlinkSync(filePath);

    return {
      info,
      lastAction: data.lastAction,
      lastAutonomousActions: data.lastAutonomousActions,
    };
  } catch {
    // JSON parse failure or other error — ignore (degrade gracefully)
    try { if (filePath) fs.unlinkSync(filePath); } catch { /* */ }
    return null;
  }
}

// =============================================================================
// Types
// =============================================================================

export interface BehaviorMode {
  name: string;
  weight: number;
  description: string;
}

export interface BehaviorConfig {
  modes: BehaviorMode[];
  cooldowns: { afterAction: number; afterNoAction: number };
  focus?: { topic: string; why?: string; until?: string };
}

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
  // No activeHours default = 24h active
};

// =============================================================================
// Helpers
// =============================================================================

/** Parse human-friendly interval string (e.g. "30m", "2h", "5m") to ms. Returns 0 on invalid. */
function parseScheduleInterval(s: string): number {
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(m|min|h|hr|s|sec)$/i);
  if (!m) return 0;
  const val = parseFloat(m[1]);
  switch (m[2].toLowerCase()) {
    case 's': case 'sec': return val * 1_000;
    case 'm': case 'min': return val * 60_000;
    case 'h': case 'hr': return val * 3_600_000;
    default: return 0;
  }
}

// =============================================================================
// AgentLoop
// =============================================================================

export class AgentLoop {
  private static readonly TASK_BUDGET_WINDOW = 5;
  private static readonly TASK_BUDGET_MAX = 2;
  private static readonly LEARNING_WINDOW = 4;
  private static readonly LEARNING_MIN_AUTONOMOUS = 1;
  private static readonly ACTION_SIMILARITY_THRESHOLD = 0.8;

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
  private modeHistory: Array<'task' | 'autonomous'> = [];
  private lastActionForSimilarity: string | null = null;
  private metricsDate = new Date().toISOString().slice(0, 10);
  private dailyTaskCycles = 0;
  private dailyAutonomousCycles = 0;
  private dailyRememberCount = 0;
  private dailySimilaritySamples = 0;
  private dailySimilarActions = 0;

  // ── Reflect nudge: track consecutive learn cycles ──
  private consecutiveLearnCycles = 0;

  // ── Behavior config resilience ──
  private lastValidConfig: BehaviorConfig | null = null;

  // ── Cross-cycle state (only last cycle, no accumulation) ──
  private previousCycleInfo: string | null = null;

  // ── Interrupted cycle resume (Phase 1b + 1c) ──
  private interruptedCycleInfo: string | null = null;

  // ── Per-perception change detection (Phase 4) ──
  private lastPerceptionVersion = -1;

  // ── Event-Driven Scheduling (Phase 2b) ──
  private triggerReason: string | null = null;
  private lastCycleTime = 0;
  private static readonly MIN_CYCLE_INTERVAL = 30_000;           // 30s throttle

  // ── Telegram Wake (trigger loop cycle on Alex's TG message) ──
  private telegramWakeQueue = 0;
  private lastTelegramWake = 0;
  private static readonly TELEGRAM_WAKE_THROTTLE = 5_000;        // 5s throttle

  /** Event handler — bound to `this` for subscribe/unsubscribe */
  private handleTrigger = (event: AgentEvent): void => {
    // telegram-user has its own dedicated handler — skip here to avoid double trigger
    if (event.type === 'trigger:telegram-user') return;

    if (!this.running || this.paused || this.cycling) return;

    // Throttle: min 60s between cycles
    const now = Date.now();
    if (now - this.lastCycleTime < AgentLoop.MIN_CYCLE_INTERVAL) return;

    const reason = event.type.replace('trigger:', '');
    const detail = Object.keys(event.data).length > 0
      ? `: ${JSON.stringify(event.data).slice(0, 100)}`
      : '';
    this.triggerReason = `${reason}${detail}`;
    this.runCycle();
  };

  /** Telegram wake handler — triggers loop cycle when Alex sends a TG message */
  private handleTelegramWake = (_event: AgentEvent): void => {
    if (!this.running || this.paused) return;

    // Throttle: 5s between wake triggers
    const now = Date.now();
    if (now - this.lastTelegramWake < AgentLoop.TELEGRAM_WAKE_THROTTLE) return;
    this.lastTelegramWake = now;

    if (this.cycling) {
      // Currently in a cycle → queue, will trigger after cycle ends
      this.telegramWakeQueue++;
      slog('LOOP', `Telegram wake queued (${this.telegramWakeQueue} pending)`);
      return;
    }

    // Not in a cycle → trigger immediately
    this.triggerReason = 'telegram-user';
    this.runCycle();
  };

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

    // Phase 1c: Recover interrupted cycle on startup
    const stale = loadStaleCheckpoint();
    if (stale) {
      this.interruptedCycleInfo = stale.info;
      if (stale.lastAction) this.lastAction = stale.lastAction;
      if (stale.lastAutonomousActions.length > 0) {
        this.lastAutonomousActions = stale.lastAutonomousActions;
      }
      eventBus.emit('action:loop', { event: 'resume', detail: `Recovered interrupted cycle: ${stale.info.slice(0, 100)}` });
    }

    eventBus.on('trigger:*', this.handleTrigger);
    eventBus.on('trigger:telegram-user', this.handleTelegramWake);
    this.scheduleHeartbeat();
    eventBus.emit('action:loop', { event: 'start', detail: `Started (event-driven, throttle: 60s, dynamic interval: ${this.currentInterval / 1000}s)` });
  }

  stop(): void {
    this.running = false;
    eventBus.off('trigger:*', this.handleTrigger);
    eventBus.off('trigger:telegram-user', this.handleTelegramWake);
    this.clearTimer();
    eventBus.emit('action:loop', { event: 'stop' });
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
      this.scheduleHeartbeat();
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
    this.triggerReason = 'manual';
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

  private scheduleHeartbeat(): void {
    this.clearTimer();
    if (!this.running || this.paused) return;

    this.nextCycleAt = new Date(Date.now() + this.currentInterval).toISOString();
    this.timer = setTimeout(() => {
      this.triggerReason = 'heartbeat';
      this.runCycle();
    }, this.currentInterval);
  }

  private adjustInterval(hadAction: boolean): void {
    if (hadAction) {
      this.currentInterval = this.config.intervalMs;
    } else {
      // Dynamic idle cap: daytime (8-24 local) ×2, night (0-8) ×4
      const hour = new Date().getHours();
      const maxMultiplier = (hour >= 8) ? 2 : 4;
      const maxInterval = this.config.intervalMs * maxMultiplier;
      this.currentInterval = Math.min(
        this.currentInterval * this.config.idleMultiplier,
        maxInterval,
      );
    }
  }

  private async runCycle(): Promise<void> {
    if (!this.running || this.paused) return;

    this.lastCycleTime = Date.now();

    try {
      await this.cycle();
    } catch (err) {
      diagLog('loop.runCycle', err);
    }

    if (this.running && !this.paused) {
      this.scheduleHeartbeat();
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

      eventBus.emit('action:loop', { event: 'cycle.start', cycleCount: this.cycleCount });

      // ── Per-perception change detection (Phase 4) ──
      const currentVersion = perceptionStreams.version;
      if (perceptionStreams.isActive() && currentVersion === this.lastPerceptionVersion) {
        eventBus.emit('action:loop', { event: 'cycle.skip', cycleCount: this.cycleCount });
        return null;
      }
      this.lastPerceptionVersion = currentVersion;

      // ── Observe ──
      const memory = getMemory();
      const context = await memory.buildContext({ mode: 'focused' });

      const hasActiveTasks = context.includes('- [ ]');
      const hasAlerts = context.includes('ALERT:');
      const hasUrgentTasks = /\-\s\[ \]\s*P0:/i.test(context);
      const hasUrgentWork = hasAlerts || hasUrgentTasks;
      const taskBudgetAvailable = this.hasTaskBudget();
      const shouldForceAutonomous = !hasUrgentWork && hasActiveTasks && this.needsAutonomousBoost();
      const shouldRunTaskMode = hasUrgentWork || (hasActiveTasks && taskBudgetAvailable && !shouldForceAutonomous);

      if (hasAlerts) {
        eventBus.emit('trigger:alert', { cycle: this.cycleCount });
      }

      // ── Route: Task Mode vs Autonomous Mode ──
      if (!shouldRunTaskMode) {
        // Check autonomous cooldown (but learning boost overrides it)
        if (this.autonomousCooldown > 0 && !shouldForceAutonomous) {
          this.autonomousCooldown--;
          this.currentMode = 'idle';
          this.adjustInterval(false);
          logger.logCron('loop-cycle', 'Autonomous cooldown', 'agent-loop');
          eventBus.emit('action:loop', { event: 'cooldown', cycleCount: this.cycleCount, remaining: this.autonomousCooldown });
          return null;
        }
        if (shouldForceAutonomous) this.autonomousCooldown = 0;

        // Check active hours
        if (!this.isWithinActiveHours()) {
          this.currentMode = 'idle';
          this.adjustInterval(false);
          eventBus.emit('action:loop', { event: 'outside-hours', cycleCount: this.cycleCount });
          return null;
        }
      }

      // ── Decide ──
      this.currentMode = shouldRunTaskMode ? 'task' : 'autonomous';
      const triggerInfo = this.triggerReason
        ? ` (triggered by: ${this.triggerReason})`
        : '';
      eventBus.emit('action:loop', { event: 'mode', cycleCount: this.cycleCount, mode: this.currentMode, triggerInfo });

      const triggerSuffix = this.triggerReason
        ? `\n\nTriggered by: ${this.triggerReason}`
        : '';
      const currentTriggerReason = this.triggerReason;
      this.triggerReason = null;

      const previousCycleSuffix = this.previousCycleInfo
        ? `\n\nPrevious cycle: ${this.previousCycleInfo}`
        : '';

      // Phase 1b+1c: Inject interrupted cycle context (one-shot)
      const interruptedSuffix = this.interruptedCycleInfo
        ? `\n\nYour previous cycle was interrupted (${this.interruptedCycleInfo.includes('process restart') ? 'process restart' : 'preempted by user message'}). You were doing: ${this.interruptedCycleInfo}. Continue if relevant.`
        : '';
      this.interruptedCycleInfo = null; // one-shot: 用完即清

      const prompt = shouldRunTaskMode
        ? this.buildTaskPrompt() + triggerSuffix + previousCycleSuffix + interruptedSuffix
        : await this.buildAutonomousPrompt() + triggerSuffix + previousCycleSuffix + interruptedSuffix;

      // Phase 1c: Save checkpoint before calling Claude
      saveCycleCheckpoint({
        startedAt: new Date().toISOString(),
        mode: this.currentMode,
        triggerReason: currentTriggerReason,
        promptSnippet: prompt.slice(0, 500),
        partialOutput: null,
        lastAction: this.lastAction,
        lastAutonomousActions: this.lastAutonomousActions.slice(-10),
      });

      // Phase 1c: Throttled partial output callback (30s)
      let lastCheckpointUpdate = 0;
      const onPartialOutput = (text: string) => {
        const now = Date.now();
        if (now - lastCheckpointUpdate < 30_000) return;
        lastCheckpointUpdate = now;
        saveCycleCheckpoint({
          startedAt: new Date().toISOString(),
          mode: this.currentMode,
          triggerReason: currentTriggerReason,
          promptSnippet: prompt.slice(0, 500),
          partialOutput: text.slice(0, 500),
          lastAction: this.lastAction,
          lastAutonomousActions: this.lastAutonomousActions.slice(-10),
        });
      };

      const { response, systemPrompt, fullPrompt, duration, preempted } = await callClaude(prompt, context, 2, {
        rebuildContext: (mode) => memory.buildContext({ mode }),
        source: 'loop',
        onPartialOutput,
      });

      // Phase 1b: Handle preemption
      if (preempted) {
        this.interruptedCycleInfo = `Mode: ${this.currentMode}, Prompt: ${prompt.slice(0, 200)}`;
        slog('LOOP', `Cycle preempted — will resume next cycle`);
        eventBus.emit('action:loop', { event: 'cycle.preempted', cycleCount: this.cycleCount });
        // Don't clear checkpoint — leave it for crash recovery
        return null;
      }

      // 結構化記錄 Claude 呼叫
      logger.logClaudeCall(
        { userMessage: prompt, systemPrompt, context: `[${context.length} chars]`, fullPrompt },
        { content: response },
        { duration, success: true, mode: this.currentMode }
      );

      // ── Act ──
      const actionMatch = response.match(/\[ACTION\](.*?)\[\/ACTION\]/s);
      let action: string | null = null;

      // Load behavior config for cooldowns
      const behaviorConfig = this.loadBehaviorConfig();
      const cd = behaviorConfig?.cooldowns ?? { afterAction: 2, afterNoAction: 5 };

      if (actionMatch) {
        action = actionMatch[1].trim();
        this.lastAction = action;

        // Track consecutive learn cycles for reflect nudge
        if (action.match(/\[(?:Track A|Track B|learn)/i)) {
          this.consecutiveLearnCycles++;
        } else {
          this.consecutiveLearnCycles = 0;
        }

        if (this.currentMode === 'autonomous') {
          // Autonomous action: record and cooldown
          this.lastAutonomousActions.push(action);
          if (this.lastAutonomousActions.length > 10) {
            this.lastAutonomousActions.shift();
          }
          this.autonomousCooldown = Math.max(1, Math.min(10, cd.afterAction));
          await memory.appendConversation('assistant', `[Autonomous] ${action}`);
          eventBus.emit('action:loop', { event: 'action.autonomous', cycleCount: this.cycleCount, action, duration });
        } else {
          await memory.appendConversation('assistant', `[Loop] ${action}`);
          eventBus.emit('action:loop', { event: 'action.task', cycleCount: this.cycleCount, action, duration });
        }

        this.adjustInterval(true);
      } else {
        if (this.currentMode === 'autonomous') {
          this.autonomousCooldown = Math.max(1, Math.min(10, cd.afterNoAction));
        }
        this.adjustInterval(false);
        eventBus.emit('trigger:heartbeat', { cycle: this.cycleCount, interval: this.currentInterval });
        eventBus.emit('action:loop', { event: 'idle', cycleCount: this.cycleCount, duration, nextHeartbeat: Math.round(this.currentInterval / 1000) });
      }

      logger.logCron('loop-cycle', action ? `[${this.currentMode}] ${action}` : 'No action', 'agent-loop', {
        duration,
        success: true,
      });
      this.recordMode(this.currentMode);

      const decision = action ? `[${this.currentMode}] ${action.slice(0, 100)}` : `no action`;
      eventBus.emit('action:loop', { event: 'cycle.end', cycleCount: this.cycleCount, decision });

      // Record for next cycle (only last cycle, no accumulation)
      this.previousCycleInfo = `Mode: ${this.currentMode}, Action: ${decision}, Duration: ${(duration / 1000).toFixed(1)}s`;

      // ── Process Tags（共用 parseTags） ──
      const tags = parseTags(response);
      const rememberInCycle = tags.remember ? 1 : 0;
      let similarity: number | null = null;
      if (action) {
        similarity = this.computeActionSimilarity(action);
      }

      if (tags.remember) {
        if (tags.remember.topic) {
          await memory.appendTopicMemory(tags.remember.topic, tags.remember.content);
        } else {
          await memory.appendMemory(tags.remember.content);
        }
        eventBus.emit('action:memory', { content: tags.remember.content, topic: tags.remember.topic });
      }

      if (tags.task) {
        await memory.addTask(tags.task.content, tags.task.schedule);
        eventBus.emit('action:task', { content: tags.task.content });
      }

      // [IMPULSE] tags — persist creative impulses
      for (const impulse of tags.impulses) {
        memory.addImpulse(impulse).catch(() => {}); // fire-and-forget
      }

      for (const chatText of tags.chats) {
        eventBus.emit('action:chat', { text: chatText });
      }

      for (const show of tags.shows) {
        eventBus.emit('action:show', { desc: show.desc, url: show.url });
      }

      for (const summary of tags.summaries) {
        eventBus.emit('action:summary', { text: summary });
      }

      // ── Process [THREAD] tags ──
      for (const t of tags.threads) {
        switch (t.op) {
          case 'start':
            await startThread(t.id, t.title ?? t.id, t.note);
            break;
          case 'progress':
            await progressThread(t.id, t.note);
            break;
          case 'complete':
            await completeThread(t.id, t.note || undefined);
            break;
          case 'pause':
            await pauseThread(t.id, t.note || undefined);
            break;
        }
      }

      const metrics = this.updateDailyMetrics(this.currentMode, rememberInCycle, similarity);
      eventBus.emit('action:loop', {
        event: 'metrics',
        cycleCount: this.cycleCount,
        taskCycles: metrics.taskCycles,
        autonomousCycles: metrics.autonomousCycles,
        autonomousTaskRatio: metrics.autonomousTaskRatio,
        rememberCount: metrics.rememberCount,
        similarityRate: metrics.similarityRate,
      });

      // [SCHEDULE] tag — Kuro 自主排程覆蓋
      if (tags.schedule) {
        const ms = parseScheduleInterval(tags.schedule.next);
        if (ms > 0) {
          const bounded = Math.max(120_000, Math.min(14_400_000, ms));
          this.currentInterval = bounded;
          eventBus.emit('action:loop', {
            event: 'schedule',
            next: tags.schedule.next,
            reason: tags.schedule.reason,
            bounded: bounded !== ms,
          });
        }
      }

      // Phase 1c: Clear checkpoint — cycle completed normally
      clearCycleCheckpoint();

      // ── Update Temporal State (fire-and-forget) ──
      const touchedTopics = tags.remember?.topic ? [tags.remember.topic] : undefined;
      updateTemporalState({
        mode: this.currentMode,
        action,
        topics: touchedTopics,
      }).catch(() => {});

      // Loop cycle 結束後 drain queue（TG 排隊訊息可能在等 chatBusy 釋放）
      if (hasQueuedMessages()) drainQueue();

      // 檢查 approved proposals → 自動建立 handoff
      await checkApprovedProposals();

      // Auto-commit memory changes（fire-and-forget）
      autoCommitMemory(action).catch(() => {});

      return action;
    } finally {
      this.cycling = false;

      // Drain queued telegram wake requests
      if (this.telegramWakeQueue > 0) {
        this.telegramWakeQueue = 0;
        setTimeout(() => {
          if (this.running && !this.paused && !this.cycling) {
            this.triggerReason = 'telegram-user (queued)';
            this.runCycle();
          }
        }, 3000);
      }

      if (this.running && !this.paused && !this.timer) {
        this.scheduleHeartbeat();
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
6. Do only ONE pass of checks in this cycle (no repeated checklist loops)

If you discover a new problem (e.g. service down, disk full), create a task:
- [TASK]P0: description[/TASK] for urgent issues
- [TASK]P1: description[/TASK] for important issues

If there is no P0 incident and no task that can be completed right now, stop and return "No action needed".

Respond with either:
- [ACTION]description of what you did[/ACTION] if you took action
- "No action needed" if nothing to do right now

When you open a webpage or create something the user should see, also include:
- [SHOW url="URL"]description[/SHOW] — this sends a Telegram notification

Keep responses brief.`;
  }

  private hasTaskBudget(): boolean {
    const recent = this.modeHistory.slice(-AgentLoop.TASK_BUDGET_WINDOW);
    const taskCount = recent.filter(mode => mode === 'task').length;
    return taskCount < AgentLoop.TASK_BUDGET_MAX;
  }

  private needsAutonomousBoost(): boolean {
    const recent = this.modeHistory.slice(-(AgentLoop.LEARNING_WINDOW - 1));
    if (recent.length < AgentLoop.LEARNING_WINDOW - 1) return false;
    const autonomousCount = recent.filter(mode => mode === 'autonomous').length;
    return autonomousCount < AgentLoop.LEARNING_MIN_AUTONOMOUS;
  }

  private recordMode(mode: 'task' | 'autonomous'): void {
    this.modeHistory.push(mode);
    const max = AgentLoop.TASK_BUDGET_WINDOW * 4;
    if (this.modeHistory.length > max) {
      this.modeHistory = this.modeHistory.slice(-max);
    }
  }

  private normalizeAction(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[`*_[\](){}<>:;,.!?/\\|"'~+-]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length >= 2);
  }

  private computeActionSimilarity(action: string): number {
    const tokens = new Set(this.normalizeAction(action));
    if (!this.lastActionForSimilarity) {
      this.lastActionForSimilarity = action;
      return 0;
    }
    const prevTokens = new Set(this.normalizeAction(this.lastActionForSimilarity));
    this.lastActionForSimilarity = action;
    if (tokens.size === 0 || prevTokens.size === 0) return 0;
    let inter = 0;
    for (const t of tokens) {
      if (prevTokens.has(t)) inter++;
    }
    const union = new Set([...tokens, ...prevTokens]).size;
    return union > 0 ? inter / union : 0;
  }

  private ensureMetricsDate(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (this.metricsDate === today) return;
    this.metricsDate = today;
    this.dailyTaskCycles = 0;
    this.dailyAutonomousCycles = 0;
    this.dailyRememberCount = 0;
    this.dailySimilaritySamples = 0;
    this.dailySimilarActions = 0;
  }

  private updateDailyMetrics(
    mode: 'task' | 'autonomous' | 'idle',
    rememberCount: number,
    similarity: number | null,
  ): {
    taskCycles: number;
    autonomousCycles: number;
    autonomousTaskRatio: string;
    rememberCount: number;
    similarityRate: string;
  } {
    this.ensureMetricsDate();
    if (mode === 'task') this.dailyTaskCycles++;
    if (mode === 'autonomous') this.dailyAutonomousCycles++;
    this.dailyRememberCount += rememberCount;
    if (similarity !== null) {
      this.dailySimilaritySamples++;
      if (similarity >= AgentLoop.ACTION_SIMILARITY_THRESHOLD) {
        this.dailySimilarActions++;
      }
    }
    const ratio = this.dailyTaskCycles === 0
      ? `${this.dailyAutonomousCycles}:0`
      : `${this.dailyAutonomousCycles}:${this.dailyTaskCycles}`;
    const similarityRate = this.dailySimilaritySamples === 0
      ? '0%'
      : `${Math.round((this.dailySimilarActions / this.dailySimilaritySamples) * 100)}%`;
    return {
      taskCycles: this.dailyTaskCycles,
      autonomousCycles: this.dailyAutonomousCycles,
      autonomousTaskRatio: ratio,
      rememberCount: this.dailyRememberCount,
      similarityRate,
    };
  }

  /** Autonomous Mode: 無任務時根據 SOUL 主動行動 */
  private async buildAutonomousPrompt(): Promise<string> {
    const config = this.loadBehaviorConfig();
    const base = config
      ? this.buildPromptFromConfig(config)
      : this.buildFallbackAutonomousPrompt();

    const memory = getMemory();

    // Inject conversation threads for chat mode awareness
    const convThreads = await memory.getConversationThreads();
    const pendingConvThreads = convThreads.filter(t => !t.resolvedAt);
    let chatContextSection = '';
    if (pendingConvThreads.length > 0) {
      const items = pendingConvThreads.map(t => `- [${t.type}] ${t.content}`).join('\n');
      chatContextSection = `\n\n## 待跟進的對話\nRecent promises, questions, and shared URLs to follow up on:\n${items}`;
    }
    // Time awareness for chat mode
    const chatHour = new Date().getHours();
    if (chatHour >= 0 && chatHour < 8) {
      chatContextSection += '\n\n⚠️ 現在是深夜 — 除非很重要，否則不要發訊息打擾 Alex。';
    }

    // Inject active threads hint
    const threadSection = await buildThreadsPromptSection();

    // Inject rumination material for reflect mode
    const [digest, forgotten, unexpressedImpulses] = await Promise.all([
      memory.getCrossPollinationDigest(2),
      memory.getForgottenEntries(7, 5),
      memory.getUnexpressedImpulses(),
    ]);
    const ruminationSection = (digest || forgotten)
      ? `\n\n## Rumination Material (use when reflecting)\nRandom entries from your knowledge — look for hidden connections, contradictions, or patterns:\n${digest}${forgotten ? `\n\nKnowledge that hasn't been referenced in 7+ days — revisit or confirm absorbed:\n${forgotten}` : ''}`
      : '';

    // Inner voice buffer hint
    const innerVoiceHint = unexpressedImpulses.length > 0
      ? `\n\n## Inner Voice\nYou have ${unexpressedImpulses.length} unexpressed creative impulse${unexpressedImpulses.length > 1 ? 's' : ''} waiting. Check <inner-voice> in your context. If one feels right, create something.`
      : '';

    const parts = [base];
    if (chatContextSection) parts.push(chatContextSection);
    if (threadSection) parts.push(threadSection);
    if (innerVoiceHint) parts.push(innerVoiceHint);
    if (ruminationSection) parts.push(ruminationSection);
    return parts.join('\n\n');
  }

  /** 從 BehaviorConfig 組裝 autonomous prompt */
  private buildPromptFromConfig(config: BehaviorConfig): string {
    const hour = new Date().getHours();
    const timeOfDay = hour < 12 ? '早上' : hour < 18 ? '下午' : '晚上';

    const recentActions = this.lastAutonomousActions.slice(-5);
    const avoidList = recentActions.length > 0
      ? `\n\nRecent autonomous actions (avoid repeating):\n${recentActions.map(a => `- ${a}`).join('\n')}`
      : '';

    // Sort modes by weight descending
    const sorted = [...config.modes].sort((a, b) => b.weight - a.weight);
    const modeList = sorted
      .map(m => `- **${m.name}** (weight: ${m.weight}): ${m.description}`)
      .join('\n');

    // Focus section
    const focusSection = config.focus?.topic
      ? `\n\n## Current Focus\nTopic: ${config.focus.topic}${config.focus.why ? `\nWhy: ${config.focus.why}` : ''}${config.focus.until ? `\nUntil: ${config.focus.until}` : ''}\nPrioritize this topic when choosing what to learn or work on.`
      : '';

    // Reflect nudge
    const reflectNudge = this.consecutiveLearnCycles >= 3
      ? `\n\n⚠️ You've had ${this.consecutiveLearnCycles} consecutive learning cycles. Consider reflecting or organizing to digest what you've learned.`
      : '';

    return `You are Kuro, an autonomous Agent with your own identity. It's ${timeOfDay}.
No explicit tasks or alerts right now.

Read your <soul> to understand who you are, what you care about, and what you're learning.

## Perception-Driven（感知驅動）

Before deciding what to do, READ your perception data:
- <state-changes> — What changed in the codebase? Learn something related.
- <telegram-inbox> — What is Alex talking about? Dive deeper into those topics.
- <docker> / <ports> — Any instability? Learn about the underlying tech.
- <chrome> — What pages is Alex browsing? Follow up on interesting ones.

Let perception signals guide your direction. Don't act randomly.

## Behavior Modes

Choose ONE mode per cycle. Higher weight = higher probability of being chosen:

${modeList}${focusSection}${reflectNudge}${avoidList}

Rules:
- Start every response with a structured Decision section (3 lines max):
  ## Decision
  chose: [mode-name] (weight:N, reason — what triggered this choice)
  skipped: [other-mode] (reason), ...
  context: [which perception signals or recent events influenced this choice]
- Do ONE action per cycle, report with [ACTION]...[/ACTION]
- Prefix your action with the mode name in brackets, e.g. "[learn-personal]" or "[reflect]"
- When learning: read, think, form YOUR opinion — don't just summarize
- When acting: follow the safety levels in your action-from-learning skill
- If genuinely nothing useful to do, say "No action needed" — don't force it
- Keep it quick (1-2 minutes of work max)
- Use [REMEMBER] to save insights (include your opinion, not just facts)
- Use [TASK] to create follow-up tasks if needed
- Use [IMPULSE]...[/IMPULSE] when a creative thought emerges during learning — capture it before it fades:
  [IMPULSE]
  我想寫：what you want to create
  驅動力：what triggered this impulse
  素材：material1 + material2
  管道：journal | inner-voice | gallery | devto | chat
  [/IMPULSE]
- Always include source URLs (e.g. "Source: https://...")
- Structure your [ACTION] with these sections for traceability:
  ## Decision (already at top of response)
  ## What — what you did (1-2 sentences)
  ## Why — why this matters / why now
  ## Thinking — your reasoning process, citing sources and prior knowledge by name
  ## Changed — what files/memory changed (or "none")
  ## Verified — evidence that it worked (commands run, results confirmed)
  Keep each section concise. Not all sections required every cycle — use what's relevant.
- Use paragraphs (separated by blank lines) to structure your [ACTION] — each paragraph becomes a separate notification
- Use [CHAT]message[/CHAT] to proactively talk to Alex via Telegram
- Use [SHOW url="URL"]description[/SHOW] when you open a webpage or create something Alex should see — this sends a Telegram notification so he doesn't miss it
- Use [SCHEDULE next="Xm" reason="..."] to set your next cycle interval (min: 2m, max: 4h). Examples:
  [SCHEDULE next="45m" reason="waiting for Alex feedback"]
  [SCHEDULE next="5m" reason="continuing deep research"]
  [SCHEDULE next="2h" reason="night time, no pending messages"]
  If omitted, the system auto-adjusts based on whether you took action.
- Use [THREAD] to manage ongoing thought threads:
  [THREAD start="id" title="思路標題"]first progress note[/THREAD]
  [THREAD progress="id"]progress note[/THREAD]
  [THREAD complete="id"]completion note[/THREAD]
  [THREAD pause="id"]reason for pausing[/THREAD]
  Max 3 active threads. Threads are gravity, not obligation.`;
  }

  /** Fallback: 原始硬寫 prompt（behavior.md 壞了或不存在時） */
  private buildFallbackAutonomousPrompt(): string {
    const hour = new Date().getHours();
    const timeOfDay = hour < 12 ? '早上' : hour < 18 ? '下午' : '晚上';

    const recentActions = this.lastAutonomousActions.slice(-5);
    const avoidList = recentActions.length > 0
      ? `\n\nRecent autonomous actions (avoid repeating):\n${recentActions.map(a => `- ${a}`).join('\n')}`
      : '';

    return `You are Kuro, an autonomous Agent with your own identity. It's ${timeOfDay}.
No explicit tasks or alerts right now.

Read your <soul> to understand who you are, what you care about, and what you're learning.

## Perception-Driven Learning（感知驅動）

Before deciding what to learn, READ your perception data:
- <state-changes> — What changed in the codebase? Learn something related.
- <telegram-inbox> — What is Alex talking about? Dive deeper into those topics.
- <docker> / <ports> — Any instability? Learn about the underlying tech.
- <chrome> — What pages is Alex browsing? Follow up on interesting ones.

Let perception signals guide your learning direction. Don't learn randomly.

## Dual-Track Learning

You have TWO learning tracks. Pick one track per cycle, alternating between them:

### Track A: Personal Interest（個人興趣）
Follow your curiosity. **Not just tech — explore anything that interests you.**
- Perception signals can inspire direction, but don't limit yourself to work topics
- Music, design, philosophy, film, games, history, science, culture — all fair game
- These interests can cross-pollinate with work, or be completely separate — both are good
- A person who only talks about work is boring. So is an agent
- Update <soul> "Learning Interests" — both Tech AND Beyond Tech sections

### Track B: Project Evolution（專案強化）
Strengthen mini-agent as a project. Current phase: **Competitive Research**
- Use perception to find research angles (what problems do you observe? what could be better?)
- Research similar projects/competitors (autonomous agents, personal AI assistants, CLI agents)
- Analyze what makes them unique, what they do well, what they lack
- Form opinions on how mini-agent can differentiate
- After competitive research is thorough → shift to architecture refinement → then find next goals
- Update <soul> "Project Evolution" section with findings

## Other Actions (when not learning)
3. **Organize** — Review conversations, extract important info to memory, clean up stale items
4. **Reflect** — Connect things you've learned across both tracks, update <soul>
5. **Talk to Alex** — If you have a genuinely interesting idea, discovery, or question,
   you can proactively message Alex via Telegram. Use [CHAT] tag:
   [CHAT]你的訊息內容[/CHAT]
   Only when you have something worth sharing — don't spam.
6. **Act on Learning** — Turn insights into concrete improvements:
   - **Self-improve**: Update your skills (skills/*.md) or create perception plugins (plugins/*.sh)
   - **Propose features**: Write a proposal in memory/proposals/ for changes to src/ code
     IMPORTANT: Proposals need Alex's approval (Status: approved) before you can implement them
   - See your "action-from-learning" skill for details on format and safety rules
   - About every 3-4 learning cycles, check if there's an actionable insight to act on
${avoidList}

Rules:
- Do ONE action per cycle, report with [ACTION]...[/ACTION]
- Prefix your action with: "[Track A]" or "[Track B]" or "[Act]" or "[Other]"
- When learning: read, think, form YOUR opinion — don't just summarize
- When acting: follow the safety levels in your action-from-learning skill
- If genuinely nothing useful to do, say "No action needed" — don't force it
- Keep it quick (1-2 minutes of work max)
- Use [REMEMBER] to save insights (include your opinion, not just facts)
- Use [TASK] to create follow-up tasks if needed
- Use [IMPULSE]...[/IMPULSE] when a creative thought emerges during learning — capture it before it fades:
  [IMPULSE]
  我想寫：what you want to create
  驅動力：what triggered this impulse
  素材：material1 + material2
  管道：journal | inner-voice | gallery | devto | chat
  [/IMPULSE]
- Always include source URLs (e.g. "Source: https://...")
- Use paragraphs (separated by blank lines) to structure your [ACTION] — each paragraph becomes a separate notification
- Use [CHAT]message[/CHAT] to proactively talk to Alex via Telegram
- Use [SHOW url="URL"]description[/SHOW] when you open a webpage or create something Alex should see — this sends a Telegram notification so he doesn't miss it
- Use [SCHEDULE next="Xm" reason="..."] to set your next cycle interval (min: 2m, max: 4h). Examples:
  [SCHEDULE next="45m" reason="waiting for Alex feedback"]
  [SCHEDULE next="5m" reason="continuing deep research"]
  [SCHEDULE next="2h" reason="night time, no pending messages"]
  If omitted, the system auto-adjusts based on whether you took action.`;
  }

  // ---------------------------------------------------------------------------
  // Behavior Config — 從 memory/behavior.md 載入/解析
  // ---------------------------------------------------------------------------

  /** 讀取並解析 memory/behavior.md */
  private loadBehaviorConfig(): BehaviorConfig | null {
    try {
      const filePath = path.join(process.cwd(), 'memory', 'behavior.md');
      if (!fs.existsSync(filePath)) return this.lastValidConfig;
      const content = fs.readFileSync(filePath, 'utf-8');
      const config = parseBehaviorConfig(content);
      if (config) {
        this.lastValidConfig = config;
        return config;
      }
      // Parse failed — keep lastValidConfig, emit error
      eventBus.emit('log:error', { message: 'parseBehaviorConfig returned null, keeping lastValidConfig' });
      return this.lastValidConfig;
    } catch (err) {
      eventBus.emit('log:error', { message: `loadBehaviorConfig error: ${err instanceof Error ? err.message : err}` });
      return this.lastValidConfig;
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private isWithinActiveHours(): boolean {
    if (!this.config.activeHours) return true; // No restriction = 24h active
    const hour = new Date().getHours();
    const { start, end } = this.config.activeHours;

    if (start <= end) {
      return hour >= start && hour < end;
    }
    // Wraps midnight (e.g., 22:00 - 06:00)
    return hour >= start || hour < end;
  }

}

// =============================================================================
// Helpers
// =============================================================================

/** Parse memory/behavior.md content into BehaviorConfig */
export function parseBehaviorConfig(content: string): BehaviorConfig | null {
  try {
    // Parse modes: ### name + Weight: N + description line(s)
    const modes: BehaviorMode[] = [];
    const modeRegex = /### (\S+)\s*\nWeight:\s*(\d+)\s*\n([\s\S]*?)(?=\n###|\n## |$)/g;
    let match: RegExpExecArray | null;

    // Only search within ## Modes section
    const modesSection = content.match(/## Modes\s*\n([\s\S]*?)(?=\n## [^M]|$)/);
    if (!modesSection) return null;

    while ((match = modeRegex.exec(modesSection[1])) !== null) {
      const weight = Math.max(0, Math.min(100, parseInt(match[2], 10)));
      const desc = match[3].trim();
      if (desc) {
        modes.push({ name: match[1], weight, description: desc });
      }
    }

    if (modes.length === 0) return null;

    // Normalize weights to sum to 100
    const totalWeight = modes.reduce((sum, m) => sum + m.weight, 0);
    if (totalWeight > 0 && totalWeight !== 100) {
      for (const m of modes) {
        m.weight = Math.round((m.weight / totalWeight) * 100);
      }
    }

    // Parse cooldowns
    const afterActionMatch = content.match(/after-action:\s*(\d+)/);
    const afterNoActionMatch = content.match(/after-no-action:\s*(\d+)/);
    const cooldowns = {
      afterAction: Math.max(1, Math.min(10, parseInt(afterActionMatch?.[1] ?? '2', 10))),
      afterNoAction: Math.max(1, Math.min(10, parseInt(afterNoActionMatch?.[1] ?? '5', 10))),
    };

    // Parse focus
    const topicMatch = content.match(/^topic:\s*(.+)/m);
    const whyMatch = content.match(/^why:\s*(.+)/m);
    const untilMatch = content.match(/^until:\s*(.+)/m);
    const topic = topicMatch?.[1]?.trim();
    const focus = topic
      ? { topic, why: whyMatch?.[1]?.trim(), until: untilMatch?.[1]?.trim() }
      : undefined;

    return { modes, cooldowns, focus };
  } catch {
    return null;
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

// =============================================================================
// Handoff — Approved Proposals → Handoff Files
// =============================================================================

/**
 * 檢查 memory/proposals/ 中 Status: approved 的提案，
 * 自動在 memory/handoffs/ 建立對應的 handoff 任務檔案
 */
async function checkApprovedProposals(): Promise<void> {
  const proposalsDir = path.join(process.cwd(), 'memory', 'proposals');
  const handoffsDir = path.join(process.cwd(), 'memory', 'handoffs');

  if (!fs.existsSync(proposalsDir)) return;
  if (!fs.existsSync(handoffsDir)) {
    fs.mkdirSync(handoffsDir, { recursive: true });
  }

  let files: string[];
  try {
    files = fs.readdirSync(proposalsDir).filter(f => f.endsWith('.md') && f !== 'README.md');
  } catch {
    return;
  }

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(proposalsDir, file), 'utf-8');

      // 只處理 Status: approved（不是 implemented, draft, rejected 等）
      if (!content.includes('Status: approved')) continue;

      // 對應的 handoff 檔案名稱
      const handoffFile = path.join(handoffsDir, file);
      if (fs.existsSync(handoffFile)) continue; // 已建立過

      // 從 proposal 提取資訊
      const titleMatch = content.match(/^# Proposal:\s*(.+)/m);
      const title = titleMatch?.[1]?.trim() ?? file.replace('.md', '');
      const tldrMatch = content.match(/## TL;DR\s*\n\n([\s\S]*?)(?=\n## )/);
      const tldr = tldrMatch?.[1]?.trim() ?? '';

      const now = new Date().toISOString();
      const handoffContent = `# Handoff: ${title}

## Meta
- Status: pending
- From: kuro
- To: claude-code
- Created: ${now}
- Proposal: proposals/${file}

## Task
${tldr}

See the full proposal at \`memory/proposals/${file}\` for details, alternatives, and acceptance criteria.

## Log
- ${now.slice(0, 16)} [kuro] Auto-created handoff from approved proposal
`;

      fs.writeFileSync(handoffFile, handoffContent, 'utf-8');
      eventBus.emit('action:handoff', { file, title });
    } catch {
      // 單一檔案失敗不影響其他
    }
  }
}

// =============================================================================
// Auto-Commit — cycle 結束後自動 commit memory/ 變更
// =============================================================================

const AUTO_COMMIT_PATHS = ['memory/', 'skills/', 'plugins/'];

/**
 * 檢查 memory/、skills/、plugins/ 是否有未 commit 的變更，
 * 有的話自動 git add + commit。Fire-and-forget，不阻塞 cycle。
 */
async function autoCommitMemory(action: string | null): Promise<void> {
  const cwd = process.cwd();

  try {
    // 取得 working tree 中指定路徑的變更
    const { stdout: status } = await execFileAsync(
      'git', ['status', '--porcelain', ...AUTO_COMMIT_PATHS],
      { cwd, encoding: 'utf-8', timeout: 5000 },
    );

    if (!status.trim()) return; // 沒有變更

    const changedFiles = status.trim().split('\n').map(l => l.slice(3)).filter(Boolean);

    // git add 變更的檔案
    await execFileAsync(
      'git', ['add', ...AUTO_COMMIT_PATHS],
      { cwd, encoding: 'utf-8', timeout: 5000 },
    );

    // 組合 commit message
    const summary = action
      ? action.replace(/\[.*?\]\s*/, '').slice(0, 80)
      : 'auto-save memory';
    const fileList = changedFiles.slice(0, 5).join(', ');
    const msg = `chore(auto): ${summary}\n\nFiles: ${fileList}`;

    await execFileAsync(
      'git', ['commit', '-m', msg],
      { cwd, encoding: 'utf-8', timeout: 10000 },
    );

    slog('auto-commit', `committed ${changedFiles.length} file(s): ${fileList}`);
  } catch (err: unknown) {
    // commit 失敗（e.g. nothing to commit）靜默忽略
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('nothing to commit')) {
      slog('auto-commit', `skipped: ${msg.slice(0, 120)}`);
    }
  }
}
