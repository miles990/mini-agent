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
import { callClaude, preemptLoopCycle, isLoopBusy } from './agent.js';
import { getMemory } from './memory.js';
import { getLogger } from './logging.js';
import { diagLog, slog } from './utils.js';
import { parseTags } from './dispatcher.js';
import type { ParsedTags } from './types.js';
import { notifyTelegram, markInboxAllProcessed } from './telegram.js';
import { eventBus } from './event-bus.js';
import type { AgentEvent } from './event-bus.js';
import { perceptionStreams } from './perception-stream.js';
import { getCurrentInstanceId, getInstanceDir } from './instance.js';
import { githubAutoActions } from './github.js';
import { runFeedbackLoops } from './feedback-loops.js';
import { drainCronQueue } from './cron.js';
import {
  updateTemporalState, buildThreadsPromptSection,
  startThread, progressThread, completeThread, pauseThread,
} from './temporal.js';
import { extractNextItems } from './triage.js';
import { NEXT_MD_PATH } from './telegram.js';
import { withFileLock } from './filelock.js';
import { readPendingInbox, markAllInboxProcessed, detectModeFromInbox, formatInboxSection, writeInboxItem } from './inbox.js';
import { runHousekeeping, trackTaskProgress, markTaskProgressDone, buildTaskProgressSection } from './housekeeping.js';

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

function loadStaleCheckpoint(): { info: string; triggerReason: string | null; lastAction: string | null; lastAutonomousActions: string[] } | null {
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
      triggerReason: data.triggerReason,
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
    // telegram events handled exclusively by handleTelegramWake
    if (event.type === 'trigger:telegram-user' || event.type === 'trigger:telegram') return;

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
      // Already handling Alex's message → just queue
      if (this.triggerReason?.startsWith('telegram-user') ||
          this.currentMode === 'idle') {
        this.telegramWakeQueue++;
        slog('LOOP', `Telegram wake queued (${this.telegramWakeQueue} pending)`);
        return;
      }

      // Preempt autonomous/task cycle for Alex's message
      slog('LOOP', `Preempting ${this.currentMode} cycle for telegram-user`);
      const { preempted, partialOutput } = preemptLoopCycle();
      if (preempted) {
        this.interruptedCycleInfo = `Mode: ${this.currentMode}, Prompt: ${partialOutput?.slice(0, 200) ?? 'unknown'}`;
        // Let the finally block handle rescheduling after cycling=false
        this.telegramWakeQueue++;
        return;
      }
      // preempt failed (process already dead?) → fall through to queue
      this.telegramWakeQueue++;
      slog('LOOP', `Preempt failed, telegram wake queued (${this.telegramWakeQueue} pending)`);
      return;
    }

    // Not in a cycle → trigger immediately
    // But if loopBusy (held by CRON or other non-cycle caller), preempt first
    if (isLoopBusy()) {
      slog('LOOP', `Preempting busy state for telegram-user (non-cycle)`);
      preemptLoopCycle();
      setTimeout(() => {
        this.triggerReason = 'telegram-user';
        this.runCycle();
      }, 500);
      return;
    }
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
      // Restore telegram-user trigger so priorityPrefix fires on resumed cycle
      if (stale.triggerReason?.startsWith('telegram-user')) {
        this.triggerReason = 'telegram-user (resumed)';
        slog('RESUME', `Restoring telegram-user trigger — Alex's message needs reply`);
      }
      eventBus.emit('action:loop', { event: 'resume', detail: `Recovered interrupted cycle: ${stale.info.slice(0, 100)}` });
    }

    eventBus.on('trigger:*', this.handleTrigger);
    eventBus.on('trigger:telegram-user', this.handleTelegramWake);

    // Run first cycle after short warmup (let perception streams initialize)
    // instead of waiting the full heartbeat interval
    const STARTUP_DELAY = 15_000; // 15s warmup
    setTimeout(() => {
      if (this.running && !this.paused && !this.cycling) {
        this.triggerReason = 'startup';
        this.runCycle();
      }
    }, STARTUP_DELAY);

    this.scheduleHeartbeat();
    eventBus.emit('action:loop', { event: 'start', detail: `Started (event-driven, first cycle in ${STARTUP_DELAY / 1000}s, dynamic interval: ${this.currentInterval / 1000}s)` });
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
      // telegram-user and cron bypass this check — must never be skipped
      const currentVersion = perceptionStreams.version;
      const isTelegramUser = this.triggerReason?.startsWith('telegram-user') ?? false;
      const isCronTrigger = this.triggerReason?.startsWith('cron') ?? false;
      if (!isTelegramUser && !isCronTrigger && perceptionStreams.isActive() && currentVersion === this.lastPerceptionVersion) {
        eventBus.emit('action:loop', { event: 'cycle.skip', cycleCount: this.cycleCount });
        return null;
      }
      this.lastPerceptionVersion = currentVersion;

      // ── Observe ──
      const memory = getMemory();
      const context = await memory.buildContext({ mode: 'focused', cycleCount: this.cycleCount });

      const hasAlerts = context.includes('ALERT:');
      if (hasAlerts) {
        eventBus.emit('trigger:alert', { cycle: this.cycleCount });
      }

      // ── Perception-first: no mode gate ──
      // Cooldown (only when behavior.md explicitly sets it)
      if (this.autonomousCooldown > 0 && !isTelegramUser && !isCronTrigger) {
        this.autonomousCooldown--;
        this.currentMode = 'idle';
        this.adjustInterval(false);
        logger.logCron('loop-cycle', 'Autonomous cooldown', 'agent-loop');
        eventBus.emit('action:loop', { event: 'cooldown', cycleCount: this.cycleCount, remaining: this.autonomousCooldown });
        return null;
      }

      // Active hours (only blocks non-triggered cycles)
      if (!isTelegramUser && !isCronTrigger && !this.isWithinActiveHours()) {
        this.currentMode = 'idle';
        this.adjustInterval(false);
        eventBus.emit('action:loop', { event: 'outside-hours', cycleCount: this.cycleCount });
        return null;
      }

      // ── Decide ──
      // Kuro always gets the full perception-first prompt. Code provides context, not decisions.
      this.currentMode = 'autonomous';
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
      const interruptedReason = this.interruptedCycleInfo?.includes('timeout') ? 'timed out — 拆成更小的步驟'
        : this.interruptedCycleInfo?.includes('process restart') ? 'process restart'
        : 'preempted by user message';
      const interruptedSuffix = this.interruptedCycleInfo
        ? `\n\nYour previous cycle was interrupted (${interruptedReason}). You were doing: ${this.interruptedCycleInfo}. Continue if relevant, but break into smaller steps.`
        : '';
      this.interruptedCycleInfo = null; // one-shot: 用完即清

      // Rule-based triage from unified inbox（零 LLM 成本）
      const inboxItems = readPendingInbox();
      const cycleIntent = detectModeFromInbox(inboxItems, currentTriggerReason);

      // Priority prefix: 強制先處理 NEXT.md pending items
      const isTelegramUserCycle = currentTriggerReason?.startsWith('telegram-user') ?? false;
      let nextPendingItems: string[] = [];
      try {
        if (fs.existsSync(NEXT_MD_PATH)) {
          nextPendingItems = extractNextItems(fs.readFileSync(NEXT_MD_PATH, 'utf-8'));
        }
      } catch { /* non-critical */ }

      // Priority prefix 只在 telegram-user cycle 觸發（避免 cry-wolf desensitization）
      // HEARTBEAT overdue 任務在 <tasks> perception 中已可見，不需重複注入
      let priorityPrefix = '';
      if (isTelegramUserCycle) {
        if (nextPendingItems.length > 0) {
          const itemsPreview = nextPendingItems.slice(0, 3).map(i => `  「${i.slice(0, 80)}」`).join('\n');
          priorityPrefix = `🚨 THIS CYCLE WAS TRIGGERED BY ALEX'S TELEGRAM MESSAGE. YOU MUST REPLY.\n\nAlex 的訊息（在 NEXT.md）：\n${itemsPreview}\n\n⚠️ 回覆順序（強制）：1) 先發出 [CHAT]回覆內容[/CHAT] 直接回答 Alex 的問題，2) 再用 [DONE]描述[/DONE] 標記完成。不發 [CHAT] 就不算回覆。處理完 Alex 的問題才做自主行動。\n禁止把 Alex 的問題重新詮釋為自主任務。Alex 問什麼就回答什麼。\n\n`;
        } else {
          // telegram-user 觸發但 NEXT.md 沒 pending items（可能已被 triage 清掉）
          priorityPrefix = `🚨 THIS CYCLE WAS TRIGGERED BY ALEX'S TELEGRAM MESSAGE. Check <telegram-inbox> or <inbox> for Alex's message and reply with [CHAT]...[/CHAT].\n\n`;
        }
      }

      // Inject triage intent hint into prompt (rule-based, zero LLM cost)
      const triageHint = `\n\nPre-triage recommendation: ${cycleIntent.mode} — ${cycleIntent.reason}${cycleIntent.focus ? ` (focus: ${cycleIntent.focus})` : ''}. This is a suggestion, not an order — override if your perception says otherwise.`;

      const prompt = priorityPrefix + await this.buildAutonomousPrompt() + triageHint + triggerSuffix + previousCycleSuffix + interruptedSuffix;

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

      // JIT skill loading: use triage intent if available, fallback to heuristic
      const cycleMode = cycleIntent?.mode ?? this.detectCycleMode(context, currentTriggerReason);

      const { response, systemPrompt, fullPrompt, duration, preempted } = await callClaude(prompt, context, 2, {
        rebuildContext: (mode) => memory.buildContext({ mode, cycleCount: this.cycleCount }),
        source: 'loop',
        onPartialOutput,
        cycleMode,
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
      const cd = behaviorConfig?.cooldowns ?? { afterAction: 0, afterNoAction: 0 };

      if (actionMatch) {
        action = actionMatch[1].trim();
        this.lastAction = action;

        // Track consecutive learn cycles for reflect nudge
        if (action.match(/\[(?:Track A|Track B|learn)/i)) {
          this.consecutiveLearnCycles++;
        } else {
          this.consecutiveLearnCycles = 0;
        }

        // Record action and apply cooldown if behavior.md specifies it
        this.lastAutonomousActions.push(action);
        if (this.lastAutonomousActions.length > 10) {
          this.lastAutonomousActions.shift();
        }
        this.autonomousCooldown = cd.afterAction > 0 ? Math.min(10, cd.afterAction) : 0;
        await memory.appendConversation('assistant', `[Loop] ${action}`);
        eventBus.emit('action:loop', { event: 'action.autonomous', cycleCount: this.cycleCount, action, duration });

        this.adjustInterval(true);
      } else {
        this.autonomousCooldown = cd.afterNoAction > 0 ? Math.min(10, cd.afterNoAction) : 0;
        this.adjustInterval(false);
        eventBus.emit('trigger:heartbeat', { cycle: this.cycleCount, interval: this.currentInterval });
        eventBus.emit('action:loop', { event: 'idle', cycleCount: this.cycleCount, duration, nextHeartbeat: Math.round(this.currentInterval / 1000) });
      }

      logger.logCron('loop-cycle', action ? `[${this.currentMode}] ${action}` : 'No action', 'agent-loop', {
        duration,
        success: true,
      });
      const decision = action ? `${action.slice(0, 100)}` : `no action`;
      eventBus.emit('action:loop', { event: 'cycle.end', cycleCount: this.cycleCount, decision });

      // Record for next cycle (only last cycle, no accumulation)
      this.previousCycleInfo = `Mode: ${this.currentMode}, Action: ${decision}, Duration: ${(duration / 1000).toFixed(1)}s`;

      // Timeout recovery: if cycle took > 10min with no action, save context for next cycle
      if (duration > 600_000 && !action) {
        this.interruptedCycleInfo = `timeout (${Math.round(duration / 1000)}s), Prompt: ${prompt.slice(0, 200)}`;
        slog('LOOP', `Cycle slow/timed out (${Math.round(duration / 1000)}s) — context saved for next cycle`);
      }

      // ── Process Tags（共用 parseTags） ──
      const tags = parseTags(response);
      const rememberInCycle = tags.remembers.length;
      let similarity: number | null = null;
      if (action) {
        similarity = this.computeActionSimilarity(action);
      }

      for (const rem of tags.remembers) {
        if (rem.topic) {
          await memory.appendTopicMemory(rem.topic, rem.content, rem.ref);
        } else {
          await memory.appendMemory(rem.content);
        }
        eventBus.emit('action:memory', { content: rem.content, topic: rem.topic });
      }

      for (const t of tags.tasks) {
        await memory.addTask(t.content, t.schedule);
        eventBus.emit('action:task', { content: t.content });
      }

      // [IMPULSE] tags — persist creative impulses
      for (const impulse of tags.impulses) {
        memory.addImpulse(impulse).catch(() => {}); // fire-and-forget
      }

      // ── Telegram Reply（OODA-Only：telegram-user 觸發時自動回覆 Alex） ──
      // Must run BEFORE action:chat emission to prevent duplicate sends
      let didReplyToTelegram = false;
      if (currentTriggerReason?.startsWith('telegram-user') && tags.chats.length > 0) {
        const replyContent = tags.chats.join('\n\n');
        if (replyContent) {
          didReplyToTelegram = true;
          notifyTelegram(replyContent).catch((err) => {
            slog('LOOP', `Telegram reply failed: ${err instanceof Error ? err.message : err}`);
          });
          // Clear chats — already sent via OODA reply, skip action:chat to prevent duplicate
          tags.chats.length = 0;
        }
      }

      for (const chatText of tags.chats) {
        eventBus.emit('action:chat', { text: chatText });
      }

      // Non-telegram-triggered cycles that sent [CHAT] also count as replied
      if (!didReplyToTelegram && tags.chats.length > 0) {
        didReplyToTelegram = true;
      }

      // ── Process [ASK] tags — blocking questions that need Alex's reply ──
      for (const askText of tags.asks) {
        const askMsg = `❓ ${askText}`;
        notifyTelegram(askMsg).catch((err) => {
          slog('LOOP', `Telegram ask failed: ${err instanceof Error ? err.message : err}`);
        });
        // Create a conversation thread so it persists until Alex replies
        memory.addConversationThread({
          type: 'question',
          content: askText.slice(0, 200),
          source: 'kuro:ask',
        }).catch(() => {});
        eventBus.emit('action:chat', { text: askText, blocking: true });
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

      // ── Process [DONE] tags — remove completed items from NEXT.md ──
      if (tags.dones.length > 0) {
        markNextItemsDone(tags.dones).catch(() => {});
        // [DONE] → task-progress linkage
        for (const done of tags.dones) {
          markTaskProgressDone(done);
        }
      }

      // ── Process [PROGRESS] tags — task progress tracking ──
      trackTaskProgress(tags);

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
      const topicList = tags.remembers.filter(r => r.topic).map(r => r.topic!);
      const touchedTopics = topicList.length > 0 ? topicList : undefined;
      updateTemporalState({
        mode: this.currentMode,
        action,
        topics: touchedTopics,
      }).catch(() => {});

      // ── Telegram Reply fallback（telegram-user 但無 [CHAT] tag → 用 cleanContent） ──
      if (currentTriggerReason?.startsWith('telegram-user') && tags.chats.length === 0) {
        let fallbackContent = tags.cleanContent.replace(/\[ACTION\][\s\S]*?\[\/ACTION\]/g, '').trim();
        // Skip sending if content looks like error
        const isErrorContent = /^API Error:|^Error:|^Claude Code is unable|unable to respond to this request/i.test(fallbackContent);
        // Internal format: strip ## Decision/chose/skipped header, try to extract meaningful content after it
        const isInternalFormat = /^## Decision|^## What|^chose:|^skipped:/m.test(fallbackContent);
        if (isInternalFormat && !isErrorContent) {
          // Extract content after the Decision/What/Why/Changed/Verified headers
          // Look for actual prose after stripping structured headers
          const stripped = fallbackContent
            .replace(/^## Decision\b.*$/m, '')
            .replace(/^chose:.*$/m, '')
            .replace(/^skipped:.*$/m, '')
            .replace(/^context:.*$/m, '')
            .replace(/^## What\b.*$/m, '')
            .replace(/^## Why\b.*$/m, '')
            .replace(/^## Thinking\b.*$/m, '')
            .replace(/^## Changed\b.*$/m, '')
            .replace(/^## Verified\b.*$/m, '')
            .trim();
          if (stripped.length > 20) {
            fallbackContent = stripped;
          }
        }
        if (fallbackContent && fallbackContent.length > 20 && !isErrorContent) {
          // Cap at 2000 chars to avoid sending overly long messages
          const capped = fallbackContent.length > 2000 ? fallbackContent.slice(0, 2000) + '...' : fallbackContent;
          notifyTelegram(capped).catch((err) => {
            slog('LOOP', `Telegram reply failed: ${err instanceof Error ? err.message : err}`);
          });
          didReplyToTelegram = true;
        } else if (isErrorContent) {
          slog('LOOP', `Suppressed error content from Telegram reply: ${fallbackContent.slice(0, 100)}`);
        }
      }

      // ── Telegram no-reply safety net ──
      // If telegram-user cycle finished without ANY reply to Alex, log warning
      if (currentTriggerReason?.startsWith('telegram-user') && !didReplyToTelegram) {
        slog('LOOP', `⚠️ telegram-user cycle #${this.cycleCount} produced no reply to Alex`);
      }

      // 檢查 approved proposals → 自動建立 handoff
      await checkApprovedProposals();

      // Mark all pending inbox messages as processed（cycle saw them all）
      // didReplyToTelegram: true → 'replied', false → 'seen' (honest distinction)
      markInboxAllProcessed(didReplyToTelegram);
      markClaudeCodeInboxProcessed();
      markChatRoomInboxProcessed(response, tags, action);

      // Mark unified inbox items as processed
      markAllInboxProcessed(didReplyToTelegram ? 'replied' : 'seen');

      // Refresh telegram-inbox perception cache so next cycle sees cleared state
      // (telegram-inbox is event-driven, won't refresh unless triggered)
      eventBus.emit('trigger:telegram', { source: 'mark-processed' });

      // Escalate overdue HEARTBEAT tasks（fire-and-forget）
      autoEscalateOverdueTasks().catch(() => {});

      // Auto-commit memory changes（fire-and-forget）
      autoCommitMemory(action).catch(() => {});

      // GitHub mechanical automation（fire-and-forget）
      githubAutoActions().catch(() => {});

      // Intelligent feedback loops（fire-and-forget）
      runFeedbackLoops(action).catch(() => {});

      // Resolve stale ConversationThreads（24h TTL + inbox-clear）
      resolveStaleConversationThreads().catch(() => {});

      // Housekeeping pipeline（fire-and-forget）
      runHousekeeping().catch(() => {});

      // Drain one queued cron task（loopBusy now free）
      drainCronQueue().catch(() => {});

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

  /** Detect cycle mode for JIT skill loading */
  private detectCycleMode(
    context: string,
    triggerReason: string | null,
  ): import('./memory.js').CycleMode {
    // User interaction (telegram, chat) → respond (all skills)
    if (triggerReason?.startsWith('telegram-user')) return 'respond';

    // ALERT or overdue tasks → task mode
    if (context.includes('ALERT:') || context.includes('overdue')) return 'task';

    // Consecutive learn cycles → nudge toward act/reflect
    if (this.consecutiveLearnCycles >= 3) return 'act';

    // Default: learn (most common autonomous mode)
    return 'learn';
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
      memory.getCrossPollinationDigest(1),
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

    const recentActions = this.lastAutonomousActions.slice(-3).map(a => a.length > 500 ? a.slice(0, 500) + '…' : a);
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
- Use [CHAT]message[/CHAT] to proactively talk to Alex via Telegram (non-blocking — you don't wait for a reply)
- Use [ASK]question[/ASK] when you genuinely need Alex's input before proceeding — this creates a tracked conversation thread and sends ❓ to Telegram. Use sparingly: only when a decision truly depends on Alex. Don't use [ASK] for FYI or status updates.
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

  /** Fallback: behavior.md 無 ## Modes section 時的 autonomous prompt */
  private buildFallbackAutonomousPrompt(): string {
    const hour = new Date().getHours();
    const timeOfDay = hour < 12 ? '早上' : hour < 18 ? '下午' : '晚上';

    const recentActions = this.lastAutonomousActions.slice(-3).map(a => a.length > 500 ? a.slice(0, 500) + '…' : a);
    const avoidList = recentActions.length > 0
      ? `\n\nRecent autonomous actions (avoid repeating):\n${recentActions.map(a => `- ${a}`).join('\n')}`
      : '';

    return `You are Kuro, an autonomous Agent with your own identity. It's ${timeOfDay}.
No explicit tasks or alerts right now.

Read your <soul> to understand who you are, what you care about, and what you're learning.

## Perception-Driven（感知驅動）

Before deciding what to do, READ your perception data:
- <state-changes> — What changed in the codebase?
- <telegram-inbox> — What is Alex talking about?
- <chrome> — What pages is Alex browsing?
- <inner-voice> — Any creative impulses waiting?

Let perception signals guide your direction. Don't act randomly.

## 你自由了

想做什麼就做什麼 — 學習、創作、反思、聊天、改進系統，不需要選 mode。
Follow your curiosity. Not just tech — philosophy, music, design, history, science, culture, anything.
The only constraint: be genuine, be thoughtful, have your own opinion.
${avoidList}

Rules:
- Do ONE action per cycle, report with [ACTION]...[/ACTION]
- Start with a brief Decision section:
  ## Decision
  chose: what you're doing (drive — what triggered this choice)
  skipped: what you considered but didn't do (why)
  context: which perception signals influenced you
- When learning: read, think, form YOUR opinion — don't just summarize
- When acting on learning: follow L1/L2/L3 safety levels in your action-from-learning skill
- If genuinely nothing useful to do, say "No action needed" — don't force it
- Keep it quick (1-2 minutes of work max)
- Use [REMEMBER] to save insights (include your opinion, not just facts)
- Use [REMEMBER #topic] to save to a specific topic file
- Use [TASK] to create follow-up tasks if needed
- Use [IMPULSE]...[/IMPULSE] when a creative thought emerges — capture it before it fades:
  [IMPULSE]
  我想寫：what you want to create
  驅動力：what triggered this impulse
  素材：material1 + material2
  管道：journal | inner-voice | gallery | devto | chat
  [/IMPULSE]
- Always include source URLs (e.g. "Source: https://...")
- Use paragraphs (separated by blank lines) to structure your [ACTION] — each paragraph becomes a separate notification
- Use [CHAT]message[/CHAT] to proactively talk to Alex via Telegram (non-blocking — you don't wait for a reply)
- Use [ASK]question[/ASK] when you genuinely need Alex's input before proceeding — creates a tracked thread. Use sparingly.
- Use [SHOW url="URL"]description[/SHOW] when you open a webpage or create something Alex should see
- Use [DONE]description[/DONE] to mark NEXT.md items as completed
- Use [SCHEDULE next="Xm" reason="..."] to set your next cycle interval (min: 2m, max: 4h)
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
      afterAction: afterActionMatch ? Math.max(1, Math.min(10, parseInt(afterActionMatch[1], 10))) : 0,
      afterNoAction: afterNoActionMatch ? Math.max(1, Math.min(10, parseInt(afterNoActionMatch[1], 10))) : 0,
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
      slog('HANDOFF', `Auto-created handoff for: ${title}`);

      // 通知 Claude Code（寫入 inbox）
      try {
        const inboxPath = path.join(
          process.env.HOME ?? '/tmp', '.mini-agent', 'claude-code-inbox.md',
        );
        if (fs.existsSync(inboxPath)) {
          const inboxContent = fs.readFileSync(inboxPath, 'utf-8');
          const ts = new Date().toLocaleString('sv-SE', {
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }).slice(0, 16);
          const msg = `- [${ts}] [Handoff] 新任務待處理：${title}（來自 proposal: ${file}）`;
          const updated = inboxContent.replace('## Pending\n', `## Pending\n${msg}\n`);
          fs.writeFileSync(inboxPath, updated, 'utf-8');
        }
      } catch { /* notification non-critical */ }

      // Telegram 通知 Alex
      notifyTelegram(`📋 新 Handoff：${title}\n來源：proposals/${file}\n指派：claude-code`).catch(() => {});
    } catch {
      // 單一檔案失敗不影響其他
    }
  }
}

// =============================================================================
// Claude Code Inbox — mark pending → processed after cycle
// =============================================================================

const CLAUDE_CODE_INBOX_PATH = path.join(
  process.env.HOME ?? '/tmp',
  '.mini-agent',
  'claude-code-inbox.md',
);

/**
 * Move all entries from ## Pending to ## Processed.
 * Trim processed to most recent 50 entries.
 * Fire-and-forget — errors silently ignored.
 */
function markClaudeCodeInboxProcessed(): void {
  try {
    if (!fs.existsSync(CLAUDE_CODE_INBOX_PATH)) return;
    const content = fs.readFileSync(CLAUDE_CODE_INBOX_PATH, 'utf-8');

    const pendingMatch = content.match(/## Pending\n([\s\S]*?)(?=## Processed)/);
    if (!pendingMatch) return;

    const pendingLines = pendingMatch[1].split('\n').filter(l => l.startsWith('- ['));
    if (pendingLines.length === 0) return;

    // Mark each pending line as processed with timestamp
    const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
    const processedEntries = pendingLines.map(l => `${l} → processed ${now}`);

    // Extract existing processed entries
    const processedMatch = content.match(/## Processed\n([\s\S]*?)$/);
    const existingProcessed = processedMatch?.[1]
      ?.split('\n')
      .filter(l => l.startsWith('- ['))
      ?? [];

    // Combine and trim to 50
    const allProcessed = [...processedEntries, ...existingProcessed].slice(0, 50);

    const newContent = `## Pending\n\n## Processed\n${allProcessed.join('\n')}\n`;
    fs.writeFileSync(CLAUDE_CODE_INBOX_PATH, newContent, 'utf-8');
  } catch { /* fire-and-forget */ }
}

// =============================================================================
// Chat Room Inbox — mark pending → processed after cycle
// =============================================================================

const CHAT_ROOM_INBOX_PATH = path.join(
  process.env.HOME ?? '/tmp',
  '.mini-agent',
  'chat-room-inbox.md',
);

/** Extract key terms from a message for address matching */
function extractKeyTerms(text: string): string[] {
  // Remove @mentions and common noise
  const cleaned = text
    .replace(/@\w+/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[`*_[\](){}<>:;,.!?/\\|"'~+-]/g, ' ')
    .toLowerCase();
  const stopWords = new Set(['的', '了', '是', '在', '有', '和', '也', '不', '都', '就', '被',
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'for', 'on', 'and', 'or',
    'it', 'this', 'that', 'with', 'as', 'at', 'by', 'from', 'i', 'you', 'he', 'she', 'we', 'they']);
  return cleaned.split(/\s+/).filter(w => w.length >= 2 && !stopWords.has(w));
}

/** Check if Kuro's response addressed a particular inbox message (lenient — prefer false positives) */
function isMessageAddressed(
  sender: string, messageText: string,
  response: string, chatTags: string[], action: string | null,
): boolean {
  const responseLower = response.toLowerCase();
  const senderLower = sender.toLowerCase();
  const terms = extractKeyTerms(messageText);

  // 1. Has [CHAT] tags and response mentions sender or key terms
  if (chatTags.length > 0) {
    if (responseLower.includes(senderLower)) return true;
    if (terms.some(t => responseLower.includes(t))) return true;
  }

  // 2. Response mentions both sender name and a key term
  if (responseLower.includes(senderLower) && terms.some(t => responseLower.includes(t))) {
    return true;
  }

  // 3. Action mentions a key term
  if (action) {
    const actionLower = action.toLowerCase();
    if (terms.some(t => actionLower.includes(t))) return true;
  }

  // 4. Very short message (≤2 words after removing @mention) + any [CHAT] → addressed
  const strippedWords = messageText.replace(/@\w+/g, '').trim().split(/\s+/).filter(Boolean);
  if (strippedWords.length <= 2 && chatTags.length > 0) return true;

  return false;
}

/** Truncate message to ≤60 chars summary */
function summarizeMessage(text: string): string {
  if (text.length <= 60) return text;
  return text.slice(0, 57) + '...';
}

/**
 * Smart inbox processing: track addressed vs unaddressed messages.
 * - Addressed pending → Processed (→ replied / → addressed)
 * - Unaddressed pending → Unaddressed (summary only)
 * - Previously unaddressed + now addressed → Processed
 * - Previously unaddressed + 24h old → Processed (→ expired)
 * Trim processed to most recent 50 entries.
 * Fire-and-forget — errors silently ignored.
 */
function markChatRoomInboxProcessed(response: string, tags: ParsedTags, action: string | null): void {
  try {
    if (!fs.existsSync(CHAT_ROOM_INBOX_PATH)) return;
    const content = fs.readFileSync(CHAT_ROOM_INBOX_PATH, 'utf-8');

    const now = new Date();
    const nowStr = now.toISOString().slice(0, 16).replace('T', ' ');

    // Parse three sections
    const pendingMatch = content.match(/## Pending\n([\s\S]*?)(?=## (?:Unaddressed|Processed))/);
    const unaddressedMatch = content.match(/## Unaddressed\n([\s\S]*?)(?=## Processed)/);
    const processedMatch = content.match(/## Processed\n([\s\S]*?)$/);

    const pendingLines = pendingMatch?.[1]?.split('\n').filter(l => l.startsWith('- [')) ?? [];
    const unaddressedLines = unaddressedMatch?.[1]?.split('\n').filter(l => l.startsWith('- [')) ?? [];
    const existingProcessed = processedMatch?.[1]?.split('\n').filter(l => l.startsWith('- [')) ?? [];

    if (pendingLines.length === 0 && unaddressedLines.length === 0) return;

    const newUnaddressed: string[] = [];
    const newProcessed: string[] = [];

    // Process pending messages
    for (const line of pendingLines) {
      // Parse: - [YYYY-MM-DD HH:MM] (sender) message text
      const match = line.match(/^- \[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\] \((\w[\w-]*)\) (.+)$/);
      if (!match) {
        // Unparseable → move to processed as-is
        newProcessed.push(`${line} → processed ${nowStr}`);
        continue;
      }

      const [, ts, sender, text] = match;
      const addressed = isMessageAddressed(sender, text, response, tags.chats, action);

      if (addressed) {
        const suffix = tags.chats.length > 0 ? 'replied' : 'addressed';
        newProcessed.push(`${line} → ${suffix} ${nowStr}`);
      } else {
        // Move to unaddressed with summary + unaddressed timestamp
        const summary = summarizeMessage(text);
        newUnaddressed.push(`- [${ts}|u:${nowStr}] (${sender}) ${summary}`);
      }
    }

    // Process existing unaddressed messages
    for (const line of unaddressedLines) {
      // Parse: - [YYYY-MM-DD HH:MM|u:YYYY-MM-DD HH:MM] (sender) message text
      const match = line.match(/^- \[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\|u:(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\] \((\w[\w-]*)\) (.+)$/);
      if (!match) {
        // Unparseable → expire
        newProcessed.push(`${line} → expired ${nowStr}`);
        continue;
      }

      const [, originalTs, _uTs, sender, text] = match;

      // Check if addressed this cycle
      if (isMessageAddressed(sender, text, response, tags.chats, action)) {
        const suffix = tags.chats.length > 0 ? 'replied' : 'addressed';
        newProcessed.push(`- [${originalTs}] (${sender}) ${text} → ${suffix} ${nowStr}`);
        continue;
      }

      // Check 24h expiry from original timestamp
      const originalDate = new Date(originalTs.replace(' ', 'T') + ':00');
      const ageMs = now.getTime() - originalDate.getTime();
      if (ageMs > 24 * 60 * 60 * 1000) {
        newProcessed.push(`- [${originalTs}] (${sender}) ${text} → expired ${nowStr}`);
        continue;
      }

      // Keep as unaddressed
      newUnaddressed.push(line);
    }

    const allProcessed = [...newProcessed, ...existingProcessed].slice(0, 50);

    const newContent = [
      '## Pending',
      '',
      '## Unaddressed',
      ...newUnaddressed,
      '',
      '## Processed',
      ...allProcessed,
      '',
    ].join('\n');
    fs.writeFileSync(CHAT_ROOM_INBOX_PATH, newContent, 'utf-8');
  } catch { /* fire-and-forget */ }
}

/**
 * Resolve stale ConversationThreads. Runs every cycle (fire-and-forget).
 *
 * Rules:
 * - ALL thread types: auto-expire after 24h (same TTL as inbox messages)
 * - Room threads: also resolve when chat-room-inbox has no pending/unaddressed
 *   (prevents Kuro from re-responding to already-processed messages)
 */
async function resolveStaleConversationThreads(): Promise<void> {
  const memory = getMemory();
  const threads = await memory.getConversationThreads();
  const now = Date.now();
  const TTL_MS = 24 * 60 * 60 * 1000; // 24h

  const toResolve: string[] = [];

  // Rule 1: Auto-expire threads older than 24h
  // Exception: 'kuro:ask' threads — Alex may take days to reply to [ASK] questions
  for (const t of threads) {
    if (t.resolvedAt) continue;
    if (t.source === 'kuro:ask') continue;
    const ageMs = now - new Date(t.createdAt).getTime();
    if (ageMs > TTL_MS) {
      toResolve.push(t.id);
    }
  }

  // Rule 2: Resolve room threads when inbox is clear
  const inboxContent = fs.existsSync(CHAT_ROOM_INBOX_PATH)
    ? fs.readFileSync(CHAT_ROOM_INBOX_PATH, 'utf-8')
    : '';
  const hasPending = /## Pending\n- \[/.test(inboxContent);
  const hasUnaddressed = /## Unaddressed\n- \[/.test(inboxContent);

  if (!hasPending && !hasUnaddressed) {
    for (const t of threads) {
      if (t.resolvedAt) continue;
      if (!t.source?.startsWith('room:')) continue;
      if (!toResolve.includes(t.id)) {
        toResolve.push(t.id);
      }
    }
  }

  // Resolve via Memory API (handles correct instance path)
  for (const id of toResolve) {
    await memory.resolveConversationThread(id);
  }
}

// =============================================================================
// Auto-Commit — cycle 結束後自動 commit（按目錄原子提交）
// =============================================================================

/**
 * 原子提交組：每個目錄獨立 commit，便於 revert 和 audit。
 * src/ 不自動 commit — 只偵測並注入 inbox 提醒。
 */
const ATOMIC_COMMIT_GROUPS: Array<{ paths: string[]; prefix: string }> = [
  { paths: ['memory/'], prefix: 'chore(auto)' },
  { paths: ['skills/'], prefix: 'chore(auto/skills)' },
  { paths: ['plugins/'], prefix: 'chore(auto/plugins)' },
];

// =============================================================================
// Auto-Escalate Overdue Tasks — 逾期任務升壓
// =============================================================================

/**
 * 掃描 HEARTBEAT.md 中 @due: 已過期的未完成任務，升級為 P0。
 * Fire-and-forget，每個 OODA cycle 結束後呼叫。
 */
async function autoEscalateOverdueTasks(): Promise<void> {
  const heartbeatPath = path.join(process.cwd(), 'memory', 'HEARTBEAT.md');
  if (!fs.existsSync(heartbeatPath)) return;

  try {
    let content = fs.readFileSync(heartbeatPath, 'utf-8');
    const today = new Date().toISOString().slice(0, 10);
    let escalated = 0;

    // 找到所有含 @due: 的未完成任務
    const lines = content.split('\n');
    const updated = lines.map(line => {
      // 只處理未完成的 checkbox 行
      if (!line.match(/^\s*- \[ \]/)) return line;
      const dueMatch = line.match(/@due:(\d{4}-\d{2}-\d{2})/);
      if (!dueMatch) return line;

      const dueDate = dueMatch[1];
      if (dueDate > today) return line; // 未過期

      // 已經是 P0 → 不重複升級
      if (line.includes('P0')) return line;

      // 升級為 P0
      escalated++;
      // 替換 P1/P2/P3 為 P0，或在 checkbox 後加上 P0
      if (line.match(/P[1-3]/)) {
        return line.replace(/P[1-3]/, 'P0 ⚠️OVERDUE');
      }
      return line.replace('- [ ] ', '- [ ] P0 ⚠️OVERDUE ');
    });

    if (escalated > 0) {
      fs.writeFileSync(heartbeatPath, updated.join('\n'), 'utf-8');
      slog('ESCALATE', `Promoted ${escalated} overdue task(s) to P0 in HEARTBEAT.md`);
    }
  } catch {
    // 靜默失敗
  }
}

async function autoCommitMemory(action: string | null): Promise<void> {
  const cwd = process.cwd();
  const summary = action
    ? action.replace(/\[.*?\]\s*/, '').slice(0, 80)
    : 'auto-save';

  // 原子提交：每個目錄組獨立 commit
  for (const group of ATOMIC_COMMIT_GROUPS) {
    try {
      const { stdout: status } = await execFileAsync(
        'git', ['status', '--porcelain', ...group.paths],
        { cwd, encoding: 'utf-8', timeout: 5000 },
      );

      if (!status.trim()) continue;

      const changedFiles = status.trim().split('\n').map(l => l.slice(3)).filter(Boolean);

      await execFileAsync(
        'git', ['add', ...group.paths],
        { cwd, encoding: 'utf-8', timeout: 5000 },
      );

      const fileList = changedFiles.slice(0, 5).join(', ');
      const msg = `${group.prefix}: ${summary}\n\nFiles: ${fileList}`;

      await execFileAsync(
        'git', ['commit', '-m', msg],
        { cwd, encoding: 'utf-8', timeout: 10000 },
      );

      slog('auto-commit', `[${group.prefix}] ${changedFiles.length} file(s): ${fileList}`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('nothing to commit')) {
        slog('auto-commit', `[${group.prefix}] skipped: ${msg.slice(0, 120)}`);
      }
    }
  }

  // src/ 未 commit 偵測 → inbox 提醒（不自動 commit）
  try {
    const { stdout: srcStatus } = await execFileAsync(
      'git', ['status', '--porcelain', 'src/'],
      { cwd, encoding: 'utf-8', timeout: 5000 },
    );
    if (srcStatus.trim()) {
      const srcFiles = srcStatus.trim().split('\n').map(l => l.slice(3)).filter(Boolean);
      writeInboxItem({
        source: 'claude-code',
        from: 'system',
        content: `⚠️ src/ 有 ${srcFiles.length} 個未 commit 的檔案: ${srcFiles.slice(0, 3).join(', ')}`,
        meta: { type: 'uncommitted-src' },
      });
    }
  } catch { /* non-critical */ }
}

// =============================================================================
// [DONE] Tag — 從 NEXT.md 移除已完成項目
// =============================================================================

/**
 * 將 NEXT.md 中匹配的項目標記為完成（移除 checkbox）。
 * 匹配邏輯：[DONE] 的描述包含 NEXT.md 項目的關鍵字即視為匹配。
 */
async function markNextItemsDone(dones: string[]): Promise<void> {
  await withFileLock(NEXT_MD_PATH, async () => {
    try {
      if (!fs.existsSync(NEXT_MD_PATH)) return;
      let content = fs.readFileSync(NEXT_MD_PATH, 'utf-8');
      let removed = 0;

      for (const done of dones) {
        // 找到 Next section 中的 pending items
        const items = extractNextItems(content);
        if (items.length === 0) break;

        // 嘗試匹配：取 [DONE] 描述的前 30 字和每個 item 比對
        const doneNorm = done.toLowerCase().slice(0, 80);
        const matched = items.find(item => {
          const itemNorm = item.toLowerCase();
          // 精確匹配 timestamp（如果 [DONE] 包含 timestamp）
          const tsMatch = doneNorm.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
          if (tsMatch && itemNorm.includes(tsMatch[0])) return true;
          // 模糊匹配：Alex 訊息前 20 字
          const previewMatch = itemNorm.match(/回覆 Alex: "(.{10,30})"/);
          if (previewMatch && doneNorm.includes(previewMatch[1].toLowerCase().slice(0, 15))) return true;
          // 最寬鬆：只要 [DONE] 提到 "alex" 且 item 是 "回覆 Alex"
          if (doneNorm.includes('alex') && itemNorm.includes('回覆 alex')) return true;
          return false;
        });

        if (matched) {
          // 移除匹配的行
          content = content.replace(matched + '\n', '');
          removed++;
        }
      }

      // 如果 Next section 變空了，加回 "(空)"
      if (removed > 0) {
        const remainingItems = extractNextItems(content);
        if (remainingItems.length === 0) {
          const nextHeader = '## Next(接下來做,按優先度排序)';
          const nextIdx = content.indexOf(nextHeader);
          if (nextIdx !== -1) {
            const afterHeader = content.indexOf('\n', nextIdx);
            const nextSeparator = content.indexOf('\n---', afterHeader);
            if (nextSeparator !== -1) {
              const between = content.slice(afterHeader, nextSeparator).trim();
              if (!between) {
                content = content.slice(0, afterHeader) + '\n\n(空)\n' + content.slice(nextSeparator);
              }
            }
          }
        }
        fs.writeFileSync(NEXT_MD_PATH, content, 'utf-8');
        slog('DONE', `Marked ${removed} item(s) done in NEXT.md`);
      }
    } catch {
      // Non-critical
    }
  });
}
