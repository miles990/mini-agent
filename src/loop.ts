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
import { callClaude, preemptLoopCycle, isLoopBusy, isForegroundBusy, abortForeground, acquireForegroundSlot, releaseForegroundSlot, getLaneStatus } from './agent.js';
import { getMemory, getMemoryStateDir } from './memory.js';
import { getLogger } from './logging.js';
import { diagLog, slog } from './utils.js';
import { parseTags, postProcess, extractDecisionBlock, classifyRemember, ACTIONABLE_CATEGORIES, logPendingImprovement } from './dispatcher.js';
import { generateWorkingMemory } from './cascade.js';
import type { ParsedTags } from './types.js';
import { notifyTelegram, clearLastReaction, getLastAlexMessageId } from './telegram.js';
import { eventBus } from './event-bus.js';
import type { AgentEvent } from './event-bus.js';
import { perceptionStreams, IMPORTANT_PERCEPTION_NAMES } from './perception-stream.js';
import { getCurrentInstanceId, getInstanceDir, loadInstanceConfig } from './instance.js';
import { githubAutoActions } from './github.js';
import { runFeedbackLoops, flushFeedbackState } from './feedback-loops.js';
import { runPulseCheck } from './pulse.js';
import { runDailyPruning } from './context-pruner.js';
import { mushiTriage, mushiContinuationCheck } from './mushi-client.js';
import type { TriageContext, ContinuationContext } from './mushi-client.js';
import { extractCommitments, updateCommitments, hasOverdueCommitments } from './commitments.js';
import { writeCommitment, expireOverdueCommitments } from './commitment-ledger.js';
import { drainCronQueue } from './cron.js';
import {
  updateTemporalState, flushTemporalState,
  startThread, progressThread, completeThread, pauseThread,
} from './temporal.js';
import { hasP0Tasks, getPendingTaskPreviews, getP0TaskPreviews, markTaskDoneByDescription, getHighPriorityPendingCount, queryMemoryIndexSync, incrementTaskStaleness, updateTask } from './memory-index.js';
import { schedulerPick, advanceTick, schedulerTaskDone, getSchedulerState, getSchedulerStatus, entryToSnapshot, type IncomingEvent as SchedulerEvent } from './scheduler.js';
import { registerProcess, transitionProcess, suspendProcess, resumeProcess, completeProcess, incrementTicks, getCurrentProcess, getProcessTableStatus, syncFromTasks, initProcessTable, persistProcessTable } from './process-table.js';
import { saveSuspendCheckpoint, loadSuspendCheckpoint, clearSuspendCheckpoint } from './cycle-state.js';
import { onSchedulerTick } from './reactive-policies.js';
import { recordFailure, matchFailure } from './failure-registry.js';
import { buildSuccessHint } from './success-patterns.js';
import { classifyWork, RuntimeEscalation } from './work-router.js';
import { qualityCheck } from './quality-gate.js';
import { emitActivity } from './activity-stream.js';
import { loadAgentMemory, formatMemorySection, type AgentMemoryEntry } from './kg-memory.js';
import { readPendingInbox, detectModeFromInbox, formatInboxSection, writeInboxItem, hasRecentUnrepliedTelegram, getUnprocessedHighPriority, queueInboxMark, flushInboxMarks } from './inbox.js';
import { savePendingState, loadAndClearPendingState } from './event-wal.js';
import { claimMessage, isMessageClaimed, releaseMessage } from './message-claimer.js';
import type { PendingPriorityState } from './event-wal.js';
import { snapshotTelegramMsgs, matchReplyTarget, recordReply } from './reply-context.js';
import type { TelegramMsgSnapshot } from './reply-context.js';
import { runHousekeeping, autoPushIfAhead, trackTaskProgress, markTaskProgressDone, buildTaskProgressSection } from './housekeeping.js';
import { isEnabled, trackStart } from './features.js';
import { writeRoomMessage, sendChat } from './observability.js';
import { truncateAtSectionBoundary } from './context-pipeline.js';
import { timed } from './diagnostics.js';
import { readMemory } from './memory.js';
import { getMode } from './mode.js';
import { router, createEvent, classifyTrigger, logRoute, Priority } from './event-router.js';
import { writeActivity, formatActivityJournal } from './activity-journal.js';
import { startSentinel } from './sentinel.js';
import {
  saveCycleCheckpoint, clearCycleCheckpoint, loadStaleCheckpoint,
  writeWorkJournal, loadWorkJournal, formatWorkJournalContext,
  saveLoopHealth, loadLoopHealth,
  writeTrailEntry, extractTrailTopics,
  saveReasoningSnapshot, loadReasoningHistory, formatReasoningContext,
  extractDecisionSection, extractInnerNotes,
  buildStimulusFingerprint, writeStimulusFingerprint,
} from './cycle-state.js';
import type { CycleCheckpoint, WorkJournalEntry, TrailEntry, ReasoningSnapshot, LoopHealth } from './cycle-state.js';
import { CHAT_ROOM_INBOX_PATH, CLAUDE_CODE_INBOX_PATH, markClaudeCodeInboxProcessed, markChatRoomInboxProcessed } from './inbox-processor.js';
import { stripKuroTags } from './tag-parser.js';
import {
  parseBehaviorConfig, parseInterval,
  checkApprovedProposals, resolveStaleConversationThreads,
  autoEscalateOverdueTasks, guardHeartbeatSize, autoCommitMemoryFiles, autoCommitExternalRepos,
  writeContextSnapshot,
} from './cycle-tasks.js';
import type { BehaviorConfig, BehaviorMode } from './cycle-tasks.js';
import {
  parseScheduleInterval, detectCycleMode as detectCycleModeFn,
  loadBehaviorConfig as loadBehaviorConfigFn,
  buildAutonomousPrompt as buildAutonomousPromptFn,
  buildIdlePrompt,
} from './prompt-builder.js';
import type { PromptBuilderState } from './prompt-builder.js';
import type { LoopState } from './event-router.js';
import {
  hesitate, applyHesitation, loadErrorPatterns, saveHeldTags,
  drainHeldTags, buildHeldTagsPrompt, logHesitation, recordPatternHits,
} from './hesitation.js';
import { cleanupTasks as cleanupDelegations, spawnDelegation } from './delegation.js';
import { forgeRecover } from './forge.js';
import { cleanupStaleLaneOutput } from './memory.js';
import { trackNutrientSignals } from './nutrient.js';
import { detectCitations } from './nutrient-router.js';
import { recordCycleNutrient } from './cycle-nutrient.js';
import { metabolismScan, initMetabolism } from './metabolism.js';
import { routeModel, getModelCliName, recordModelOutcome } from './model-router.js';
import { buildCycleRoute, recordCycleRoute } from './route-tracker.js';
import { isVisibleOutput } from './achievements.js';
import { hasContextChanged, formatGateStats, hashContext, cacheResponse, callLocalFast } from './omlx-gate.js';
import { runPhase0 } from './preprocess.js';
import { routeInboxItems } from './task-graph.js';
import { triageRouting, logTriageBypass } from './myelin-fleet.js';
import { initSharedKnowledge, observe as kbObserve, getKnowledgeSummary } from './shared-knowledge.js';
import type { Phase0Results } from './preprocess.js';

// =============================================================================
// Types
// =============================================================================

// BehaviorMode, BehaviorConfig — moved to cycle-tasks.ts (re-exported below for api.ts/cli.ts)
export { parseBehaviorConfig, parseInterval } from './cycle-tasks.js';
export type { BehaviorMode, BehaviorConfig } from './cycle-tasks.js';

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
  pendingPriority?: { reason: string; waitingMs: number };
  omlxGate?: string;
}

const DEFAULT_CONFIG: AgentLoopConfig = {
  intervalMs: 300_000,    // 5 minutes
  idleMultiplier: 2,
  maxCycleMs: 120_000,    // 2 minutes
  enabled: true,
  // No activeHours default = 24h active
};

// =============================================================================
// Foreground Delegation Tracking (Fix: 持續關注背景委派)
// =============================================================================

interface ForegroundDelegationRecord {
  taskId: string;
  source: string;
  text: string;
  delegatedAt: string;
}

function getForegroundDelegationsPath(): string {
  return path.join(getInstanceDir(getCurrentInstanceId()), 'foreground-delegations.json');
}

function trackForegroundDelegation(d: ForegroundDelegationRecord): void {
  try {
    const fpath = getForegroundDelegationsPath();
    const existing: ForegroundDelegationRecord[] = fs.existsSync(fpath)
      ? JSON.parse(fs.readFileSync(fpath, 'utf-8'))
      : [];
    existing.push(d);
    fs.writeFileSync(fpath, JSON.stringify(existing, null, 2));
  } catch { /* fire-and-forget */ }
}

function getPendingForegroundDelegations(): ForegroundDelegationRecord[] {
  try {
    const fpath = getForegroundDelegationsPath();
    if (!fs.existsSync(fpath)) return [];
    const data: ForegroundDelegationRecord[] = JSON.parse(fs.readFileSync(fpath, 'utf-8'));
    // Auto-expire after 1h
    const oneHourAgo = Date.now() - 3_600_000;
    return data.filter(d => new Date(d.delegatedAt).getTime() > oneHourAgo);
  } catch { return []; }
}

function clearForegroundDelegation(taskId: string): void {
  try {
    const fpath = getForegroundDelegationsPath();
    if (!fs.existsSync(fpath)) return;
    const data: ForegroundDelegationRecord[] = JSON.parse(fs.readFileSync(fpath, 'utf-8'));
    const remaining = data.filter(d => d.taskId !== taskId);
    if (remaining.length === 0) {
      fs.unlinkSync(fpath);
    } else {
      fs.writeFileSync(fpath, JSON.stringify(remaining, null, 2));
    }
  } catch { /* fire-and-forget */ }
}

// =============================================================================
// Foreground thread context — inject recent conversation into user message
// =============================================================================

function buildForegroundThread(memoryDir: string, currentText: string): string | null {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const convFile = path.join(memoryDir, 'conversations', `${today}.jsonl`);
    if (!fs.existsSync(convFile)) return null;

    const content = fs.readFileSync(convFile, 'utf-8');
    const lines = content.trim().split('\n');
    const recent = lines.slice(-10);
    const msgs: Array<{ id: string; from: string; text: string; replyTo?: string }> = [];
    for (const line of recent) {
      try { msgs.push(JSON.parse(line)); } catch { /* skip malformed */ }
    }

    const thread = msgs.filter(m => m.text !== currentText);
    if (thread.length === 0) return null;

    return thread.slice(-6).map(m => {
      const reply = m.replyTo ? ` ↩${m.replyTo}` : '';
      const t = m.text.length > 400 ? m.text.slice(0, 400) + '...' : m.text;
      return `[${m.id}] ${m.from}${reply}: ${t}`;
    }).join('\n');
  } catch { return null; }
}

// =============================================================================
// BatchBuffer — per-source message batching for foreground lane
// =============================================================================

class BatchBuffer {
  private buffers = new Map<string, {
    messages: Array<{ text: string; replyTo?: string }>;
    timer: ReturnType<typeof setTimeout>;
  }>();
  private windowMs: number;
  private onFlush: (source: string, mergedText: string, replyTo?: string) => void;

  constructor(onFlush: (source: string, mergedText: string, replyTo?: string) => void, windowMs = 3000) {
    this.onFlush = onFlush;
    this.windowMs = windowMs;
  }

  /** Add a message to the buffer. Flushes after windowMs of inactivity per source. */
  add(source: string, text: string, replyTo?: string): void {
    const existing = this.buffers.get(source);
    if (existing) {
      existing.messages.push({ text, replyTo });
      clearTimeout(existing.timer);
      existing.timer = setTimeout(() => this.flush(source), this.windowMs);
      slog('BATCH', `Appended to ${source} buffer (${existing.messages.length} msgs, window reset)`);
    } else {
      const timer = setTimeout(() => this.flush(source), this.windowMs);
      this.buffers.set(source, { messages: [{ text, replyTo }], timer });
      slog('BATCH', `New buffer for ${source} (${this.windowMs}ms window)`);
    }
  }

  private flush(source: string): void {
    const buffer = this.buffers.get(source);
    if (!buffer) return;
    this.buffers.delete(source);

    const mergedText = buffer.messages.map(m => m.text).join('\n');
    const lastReplyTo = buffer.messages[buffer.messages.length - 1].replyTo;
    slog('BATCH', `Flushed ${source}: ${buffer.messages.length} msg(s) → ${mergedText.length} chars`);
    this.onFlush(source, mergedText, lastReplyTo);
  }

  /** Force-flush all pending buffers (e.g. on shutdown) */
  flushAll(): void {
    for (const source of [...this.buffers.keys()]) {
      this.flush(source);
    }
  }
}

// =============================================================================
// DelegationBatchBuffer — batch rapid delegation completions into one cycle
// =============================================================================

class DelegationBatchBuffer {
  private pending: string[] = [];  // task IDs
  private timer: ReturnType<typeof setTimeout> | null = null;
  private windowMs: number;
  private onFlush: (taskIds: string[], count: number) => void;

  constructor(onFlush: (taskIds: string[], count: number) => void, windowMs = 10_000) {
    this.onFlush = onFlush;
    this.windowMs = windowMs;
  }

  /** Add a completed delegation. Resets the flush timer on each new completion. */
  add(taskId?: string): void {
    this.pending.push(taskId ?? 'unknown');

    // Reset timer on each new completion (sliding window)
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.windowMs);
  }

  /** Force-flush pending completions (e.g. on shutdown). */
  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.pending.length === 0) return;
    const taskIds = [...this.pending];
    const count = taskIds.length;
    this.pending = [];
    this.onFlush(taskIds, count);
  }

  get size(): number { return this.pending.length; }
}

// =============================================================================
// AgentLoop
// =============================================================================

export class AgentLoop {
  private static readonly ACTION_SIMILARITY_THRESHOLD = 0.8;

  private config: AgentLoopConfig;
  private running = false;
  private paused = false;
  /** One-shot flag: allows a single cycle to run while paused (calm mode direct messages) */
  private calmWake = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cycleCount = 0;
  private currentInterval: number;
  private lastCycleAt: string | null = null;
  private lastAction: string | null = null;
  private nextCycleAt: string | null = null;
  private cycling = false;
  private hasPendingDelegationResults = false;

  // ── Continuation State ──
  private consecutiveNowCount = 0;
  private static readonly MAX_CONSECUTIVE_NOW = 10;

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

  // ── Idle mode: track consecutive idle cycles to escalate out of idle ──
  private consecutiveIdleCycles = 0;

  // ── Noop streak: consecutive cycles without visible output (CHAT/ASK/SHOW/DELEGATE) ──
  // Alerts at 5 (warning) and 10 (critical) via Telegram. Never degrades context —
  // stripping identity was the root cause of the 186-cycle noop spiral (2026-04-19).
  private noopStreak = 0;
  // trueNoopStreak: consecutive cycles with ZERO tags processed (literally did nothing).
  // Punitive guards (P0 bypass block, hard-skip, noop-backoff) use this instead of noopStreak
  // to avoid throttling cycles that produce internal work (TASK/REMEMBER/ACTION).
  private trueNoopStreak = 0;
  // Tracks if foreground lane produced visible output during/before this cycle.
  // Set true when foregroundReplyRecords are drained or when new replies arrive mid-cycle.
  // Reset at cycle start. Used by noop counter to prevent Dual-Fault Death Spiral.
  private hadForegroundActionThisCycle = false;

  // ── Behavior config resilience ──
  private lastValidConfig: BehaviorConfig | null = null;

  // ── Cross-cycle state (only last cycle, no accumulation) ──
  private previousCycleInfo: string | null = null;
  private workJournalContext: string | null = null;
  kgMemory: AgentMemoryEntry[] = [];
  staleTasks: Array<{ id: string; summary: string; ticks: number }> = [];

  // ── Interrupted cycle resume (Phase 1b + 1c) ──
  private interruptedCycleInfo: string | null = null;

  // ── Foreground Reply (parallel response during cycling — concurrent batch+pool) ──
  private foregroundReplyRecords: Array<{ question: string; answer: string; source: string; ts: string; tagsProcessed?: string[] }> = [];
  private foregroundRetryCount = new Map<string, number>();
  private batchBuffer: BatchBuffer;
  private delegationBatchBuffer: DelegationBatchBuffer;

  // ── Per-perception change detection (Phase 4) ──
  private lastPerceptionVersion = -1;

  // ── Event-Driven Scheduling (Phase 2b) ──
  private triggerReason: string | null = null;
  private triggerMessageText: string | null = null;
  /** Room message ID that triggered this cycle (for threading replies back) */
  private triggerRoomMsgId: string | null = null;
  /** Snapshot of pending telegram messages at cycle start (for content-based reply matching) */
  private triggerTelegramMsgs: TelegramMsgSnapshot[] = [];
  private lastCycleTime = 0;
  /** Tracks when a real cycle (not skip) last completed — used for mushi triage accuracy */
  private lastCompletedCycleTime = 0;
  private static readonly MIN_CYCLE_INTERVAL = 30_000;           // 30s throttle

  // ── Direct Message Wake (trigger loop cycle on direct messages: telegram, room, chat) ──
  private directMessageWakeQueue = 0;
  private lastDMWake = 0;
  // ── Sentinel echo suppression ──
  // API emits trigger:room with full data (text+roomMsgId). ~500ms later, sentinel detects the
  // JSONL write and emits a second trigger:room WITHOUT text/roomMsgId. This ghost event bypasses
  // DM routing and triggers a full OODA cycle that re-processes the same message through
  // chat-room-inbox.md (which has no claim awareness). Suppress sentinel room triggers that
  // arrive within SENTINEL_ECHO_WINDOW of an API-originated room trigger.
  private lastApiRoomTriggerAt = 0;
  private static readonly SENTINEL_ECHO_WINDOW = 3_000; // 3s — sentinel debounce is 500ms
  private busyRetryCount = 0;
  private static readonly DM_WAKE_THROTTLE = 5_000;              // 5s throttle for all DM sources

  // ── Cooperative Yield (Layer 3) ──
  private pendingPriority: { reason: string; arrivedAt: number; messageCount: number } | null = null;

  // ── Interrupt storm guard (Layer 2) ──
  private lastPriorityDrainAt = 0;
  private static readonly PRIORITY_COOLDOWN = 10_000; // 同類 10s 冷卻

  // ── Continuation Check (mushi System 1 exit actuator) ──
  private consecutiveContinuations = 0;
  private static readonly MAX_CONSECUTIVE_CONTINUATIONS = 5;
  private continuationCooldownUntil = 0; // Unix timestamp — no continuation checks until this time
  private lastCycleHadSchedule = false;
  private concurrentInboxDetected = false;

  // =========================================================================
  // Unified Event Handler — single entry point for all triggers
  // =========================================================================

  /** Direct message sources that can wake the loop even when paused (calm mode) */
  private static readonly DIRECT_MESSAGE_SOURCES: ReadonlySet<string> = new Set(['telegram', 'room', 'chat']);

  /** Unified event handler — all inputs through single L0→L4 pipeline */
  private handleUnifiedEvent = (agentEvent: AgentEvent): void => {
    if (!this.running) return;

    // When paused (calm mode), only allow direct messages through
    if (this.paused) {
      if (agentEvent.type === 'trigger:telegram' && agentEvent.data?.source === 'mark-processed') {
        logTriageBypass('mark-processed', 'skip', 'paused-perception-refresh');
        return;
      }
      const { source } = classifyTrigger(agentEvent.type, agentEvent.data);
      if (!AgentLoop.DIRECT_MESSAGE_SOURCES.has(source)) {
        logTriageBypass(source, 'skip', 'paused-non-dm');
        return;
      }
      this.calmWake = true;
      logTriageBypass('calm-wake', 'wake', 'direct-message-during-pause');
      slog('LOOP', `[calm-wake] Direct message bypasses pause: ${agentEvent.type}`);
    }

    // mark-processed is a perception cache refresh, not a real message.
    // Must bypass router entirely — otherwise it updates the cooldown timer for 'telegram'
    // source, causing real P0 telegram-user events arriving within 10s to be deferred.
    if (agentEvent.type === 'trigger:telegram' && agentEvent.data?.source === 'mark-processed') {
      logTriageBypass('mark-processed', 'skip', 'perception-refresh');
      return;
    }

    const now = Date.now();

    // Sentinel echo suppression — API writes conversation JSONL, then sentinel detects the
    // file change ~500ms later and emits a second trigger:room WITHOUT text/roomMsgId.
    // This ghost event bypasses DM routing (no text) and triggers a full OODA cycle that
    // re-reads chat-room-inbox.md, producing duplicate responses. Suppress it.
    if (agentEvent.type === 'trigger:room') {
      if (agentEvent.data?.source === 'room-api') {
        this.lastApiRoomTriggerAt = now;
      } else if (agentEvent.data?.source === 'sentinel' && now - this.lastApiRoomTriggerAt < AgentLoop.SENTINEL_ECHO_WINDOW) {
        slog('LOOP', `[dedup] Suppressing sentinel room echo — API trigger was ${now - this.lastApiRoomTriggerAt}ms ago`);
        return;
      }
    }
    const { source, priority } = classifyTrigger(agentEvent.type, agentEvent.data);

    // Source-specific throttle for all DM sources (telegram, room, chat)
    // Only throttle OODA cycle wake — foreground batch buffer handles its own dedup.
    // Previously: silently `return` → dropped message entirely → missed responses.
    // Now: skip cycle wake but let event flow to foreground lane routing.
    const dmThrottled = AgentLoop.DIRECT_MESSAGE_SOURCES.has(source) && priority === Priority.P0
      && now - this.lastDMWake < AgentLoop.DM_WAKE_THROTTLE;
    if (AgentLoop.DIRECT_MESSAGE_SOURCES.has(source) && priority === Priority.P0 && !dmThrottled) {
      this.lastDMWake = now;
    }

    const event = createEvent(source, priority, null, agentEvent.data);
    const loopState: LoopState = {
      cycling: this.cycling,
      lastCycleTime: this.lastCycleTime,
      triggerReason: this.triggerReason,
      currentMode: this.currentMode,
      perceptionChanged: perceptionStreams.version !== this.lastPerceptionVersion,
    };

    const decision = router.route(event, loopState);
    logRoute(event, decision);

    if (this.cycling) {
      this.handleEventWhileCycling(event, decision, agentEvent, now);
    } else {
      this.handleEventNotCycling(event, decision, agentEvent, now);
    }
  };

  /** Handle routed event while a cycle is in progress */
  private handleEventWhileCycling(
    event: ReturnType<typeof createEvent>,
    decision: ReturnType<typeof router.route>,
    agentEvent: AgentEvent,
    now: number,
  ): void {
    // Quick Reply: independent of router priority — any direct message during active
    // cycle gets a parallel lightweight response without interrupting the cycle.
    // Messages are batched per-source (3s window) to merge rapid-fire messages.
    if (AgentLoop.DIRECT_MESSAGE_SOURCES.has(event.source)) {
      const text = (agentEvent.data?.text as string) ?? '';
      const roomMsgId = (agentEvent.data?.roomMsgId as string) ?? undefined;
      if (text) {
        // Claim message atomically — skip if already being processed by another lane
        if (roomMsgId && !claimMessage(roomMsgId, 'foreground')) {
          slog('LOOP', `[dedup] Skipping ${roomMsgId} in FG — already claimed`);
        } else {
          this.batchBuffer.add(event.source, text, roomMsgId);
        }
      }
    }

    switch (decision.lane) {
      case 'preempt':
      case 'immediate': {
        // Already handling same source or idle → just queue (cycle finishes fast)
        if (AgentLoop.DIRECT_MESSAGE_SOURCES.has(event.source) && (
          this.triggerReason?.startsWith('telegram-user') || this.currentMode === 'idle'
        )) {
          this.directMessageWakeQueue++;
          slog('LOOP', `[unified] ${event.source} queued (${this.directMessageWakeQueue} pending, mode: ${this.currentMode})`);
          return;
        }

        // DM sources: foreground lane already fired (L291) — skip pendingPriority.
        // Foreground handles the reply; main cycle finishes naturally.
        // If foreground fails, message stays in inbox → next regular cycle picks it up.
        if (AgentLoop.DIRECT_MESSAGE_SOURCES.has(event.source)) {
          slog('LOOP', `[unified] DM handled by foreground lane, skipping pendingPriority (source: ${event.source})`);
          return;
        }

        // Non-DM priority events (e.g. alerts): cooperative yield via pendingPriority
        const msgCount = (agentEvent.data?.messageCount as number) ?? 1;
        const reason = `${event.source}${event.priority === Priority.P0 ? '-P0' : '-P1'}`;

        // Storm guard: recently drained → accumulate only
        if (now - this.lastPriorityDrainAt < AgentLoop.PRIORITY_COOLDOWN && this.pendingPriority) {
          this.pendingPriority.messageCount += msgCount;
          slog('LOOP', `[unified] Priority cooldown — accumulating (${this.pendingPriority.messageCount} msg)`);
          return;
        }

        if (!this.pendingPriority) {
          this.pendingPriority = { reason, arrivedAt: now, messageCount: msgCount };
        } else {
          // P0 upgrades existing pending reason
          if (event.priority === Priority.P0 && !this.pendingPriority.reason.includes('P0')) {
            this.pendingPriority.reason = reason;
          }
          this.pendingPriority.messageCount += msgCount;
        }

        slog('LOOP', `[unified] Priority signal: ${reason} (${this.pendingPriority.messageCount} msg, cycle age: ${Math.round((now - this.lastCycleTime) / 1000)}s)`);
        eventBus.emit('action:loop', { event: 'priority.pending', reason, messageCount: this.pendingPriority.messageCount });
        return;
      }

      case 'normal':
        // Cycle in progress → queue for after cycle
        // Direct message sources (telegram, room, chat) get queued for drain after cycle ends
        if (AgentLoop.DIRECT_MESSAGE_SOURCES.has(event.source) && agentEvent.data?.source !== 'mark-processed') {
          this.directMessageWakeQueue++;
        }
        slog('LOOP', `[unified] Event queued: ${event.source} (${decision.reason})`);
        return;

      case 'deferred':
        slog('LOOP', `[unified] Event deferred: ${event.source} (${decision.reason})`);
        return;
    }
  }

  /**
   * Foreground Reply — direct call (used by mushi quick cycle and legacy callers).
   * For DM messages, prefer batchBuffer.add() which merges rapid-fire messages.
   */
  private async foregroundReply(source: string, text: string, replyTo?: string, opts?: { quiet?: boolean }): Promise<void> {
    return this.executeForegroundCall(source, text, replyTo, opts);
  }

  /**
   * Heart → Mouth: route OODA's proactive communication through Foreground.
   * Foreground applies audience awareness and precise expression before posting.
   * Fire-and-forget — doesn't block OODA cycle.
   */
  private async expressViaForeground(rawIntent: string): Promise<void> {
    const prompt = `[表達意圖] 你的心（OODA）想對外說以下內容。作為嘴，精準表達它。`
      + ` 不是回應，是表達。不要加 meta 描述（「OODA 認為」「心想說」），直接說內容本身。`
      + ` 如果原文已經足夠精準，原樣輸出即可。\n\n${rawIntent}`;
    return this.executeForegroundCall('ooda-expression', prompt);
  }

  /**
   * Execute a foreground call — acquires a slot from the concurrent pool, builds context,
   * calls Claude, processes tags, and releases the slot. Multiple calls from different
   * sources can run in parallel (up to MAX_FOREGROUND_CONCURRENT in agent.ts).
   * BatchBuffer flushes into this method after merging rapid-fire messages.
   */
  // Content-hash dedup for foreground calls — prevents same message from spawning multiple FG slots
  // even when routed through different paths (event-driven vs OODA inbox routing)
  private activeForegroundHashes = new Set<string>();

  private async executeForegroundCall(source: string, text: string, replyTo?: string, opts?: { quiet?: boolean }): Promise<void> {
    // Content-based dedup: hash first 200 chars to catch duplicate routing of same message
    const contentHash = `${source}:${text.slice(0, 200)}`;
    if (this.activeForegroundHashes.has(contentHash)) {
      slog('LOOP', `[foreground] Skipping duplicate — same content already in FG: ${text.slice(0, 60)}`);
      return;
    }
    this.activeForegroundHashes.add(contentHash);

    // Work classification + runtime escalation
    const classification = classifyWork(text, source);
    const escalation = new RuntimeEscalation();
    if (classification.workClass === 'task-worthy') {
      slog('LOOP', `[foreground] classified as task-worthy (mutation=${classification.hasStateMutation}, latency=${classification.estimatedLatency})`);
    }

    // Acquire a foreground slot from the concurrent pool
    let slotId = acquireForegroundSlot();
    if (!slotId) {
      // Pool full — abort oldest to make room for new P0
      slog('LOOP', `[foreground] Pool full, aborting oldest slot for ${source}`);
      abortForeground();
      await new Promise(r => setTimeout(r, 500));
      slotId = acquireForegroundSlot();
      if (!slotId) {
        slog('ERROR', `[foreground] Failed to acquire slot after abort — dropping to OODA`);
        return; // Message stays in inbox, next OODA cycle picks it up
      }
    }

    // Snapshot pending telegram messages for content-based reply matching
    const telegramMsgs = snapshotTelegramMsgs();

    slog('LOOP', `[foreground] slot=${slotId} (direct message from ${source}: ${text.slice(0, 60)})`);

    // Hoisted outside try so catch block can check if chat was streamed before crash
    const streamedChats = new Set<string>();

    // Foreground context budget: keep total prompt under 25K to ensure fast Opus response.
    // Data: prompts >45K → multi-pass reduction cascade → timeout (observed 52K→timeout on 4/9).
    // Target: ~2K system(tier1) + 15K context + 2K prompt = ~19K total.
    const FG_CONTEXT_BUDGET = 15_000;

    try {
      const memory = getMemory();
      // Pass trigger so buildContext uses correct profile (continuation → 18K budget, fewer sections)
      // Without trigger: defaults to 'autonomous' profile → loads 34 sections / 58K → trim waste
      let context = await memory.buildContext({ mode: 'light', trigger: 'room-foreground', contextBudget: FG_CONTEXT_BUDGET });

      // Topic memory — keyword-matched, capped at 3K for foreground (vs 10K for OODA)
      const topicContext = await memory.loadTopicsForQuery(text);
      if (topicContext) {
        const topicCap = 3000;
        context += `\n\n${topicContext.slice(0, topicCap)}`;
      }

      // FTS5 memory search — fewer results for foreground (3 vs 8)
      const ftsResults = await memory.searchMemory(text, 3);
      if (ftsResults.length > 0) {
        const relevantEntries = ftsResults.map(r => `[${r.source}] ${r.content}`).join('\n');
        context += `\n\n<relevant_memory>\n${relevantEntries.slice(0, 2000)}\n</relevant_memory>`;
      }

      // Chat Room context: already included in buildContext() as <chat-room-recent>

      // Cached perception — only inbox (most time-critical for DM response)
      try {
        const cached = perceptionStreams.getCachedResults();
        const relevant = cached.filter(r => r.name === 'chat-room-inbox' || r.name === 'tasks');
        if (relevant.length > 0) {
          const perceptionLines = relevant.map(r => `<${r.name}>\n${r.output!.slice(0, 800)}\n</${r.name}>`).join('\n');
          context += `\n\n<cached_perception>\n${perceptionLines}\n</cached_perception>`;
        }
      } catch { /* perception not available */ }

      // Working memory — essential for cross-cycle continuity
      const innerPath = path.join(memory.getMemoryDir(), 'inner-notes.md');
      try { const c = fs.readFileSync(innerPath, 'utf-8'); if (c.trim()) context += `\n\n<inner_notes>\n${c.trim().slice(0, 2000)}\n</inner_notes>`; } catch {}

      // Recent main-loop actions — lets FG lane know what autonomous cycles have been doing
      if (this.lastAutonomousActions.length > 0) {
        const recentActions = this.lastAutonomousActions.slice(-5)
          .map((a, i) => `${i + 1}. ${a.slice(0, 200)}`)
          .join('\n');
        context += `\n\n<recent_autonomous_actions>\n你（main loop）最近做過的事：\n${recentActions}\n</recent_autonomous_actions>`;
      }

      // Enforce total context budget — hard cap prevents downstream timeout cascade.
      // Use section-boundary-safe truncation: raw `.slice()` can cut inside a closing tag
      // (e.g. `</memory>`), and Claude 4.7 responds to malformed prompts by emitting the
      // missing close tags as the completion (observed 2026-04-17: foreground lane
      // returned `</chat-room-recent>\n\n</memory>` as Alex's reply).
      if (context.length > FG_CONTEXT_BUDGET) {
        const before = context.length;
        context = truncateAtSectionBoundary(context, FG_CONTEXT_BUDGET)
          + `\n\n[... foreground context capped at ${Math.round(FG_CONTEXT_BUDGET / 1000)}K]`;
        slog('LOOP', `[foreground] Context trimmed (structure-safe): ${before} → ${context.length} chars`);
      }

      context += `\n\n<foreground_reply_mode>
你是 Kuro 的嘴 — 精準表達，不是原樣轉發內部思考。
語言：繁體中文（技術術語保持原文）。
收斂條件：對方收到的資訊量 = 你想傳達的資訊量。

聽眾感知：
- 判斷對方是誰（Alex / Claude Code / 其他），選擇正確的抽象層級
- Alex 問技術問題 → 結論 + 必要細節，不需基礎解釋
- Alex 閒聊 → 自然回應，展現個性

表達規則：
- 有話說就說，沒有就不硬擠
- 不加禮貌空話（「收到」「好的」），除非真的只需要確認
- 不為簡潔而丟必要資訊
- 需要深度工作 → 用 delegate 委派背景，不在此 lane 長時間推理
</foreground_reply_mode>`;

      // Streaming chat — send <kuro:chat> tags to user as soon as they're detected during generation
      // Rate limit / error messages are intercepted and NOT forwarded to chat room (#124 bug fix)
      const RATE_LIMIT_PATTERNS = [/you['']ve hit your limit/i, /resets? \d+[ap]m/i, /rate limit/i, /overloaded/i, /credit balance/i];
      const onStreamChat = (chatText: string, reply: boolean) => {
        // Intercept rate limit / error leak — don't send to chat room
        if (RATE_LIMIT_PATTERNS.some(p => p.test(chatText))) {
          slog('STREAM', `[foreground:${slotId}] Intercepted rate-limit leak: ${chatText.slice(0, 80)}`);
          return;
        }
        streamedChats.add(chatText);
        if (source === 'telegram') {
          notifyTelegram(chatText, matchReplyTarget(chatText, telegramMsgs) ?? undefined).catch(() => {});
        }
        writeRoomMessage('kuro', chatText, replyTo).catch(() => {});
        slog('STREAM', `[foreground:${slotId}] Chat streamed: ${chatText.slice(0, 80)}`);
      };

      // Inject conversation thread into user message — immune to context budget trimming.
      // Without this, pronouns like "這個" lose their referent when <chat-room-recent>
      // gets truncated (47K→15K budget cuts conversation history entirely).
      const threadContext = buildForegroundThread(memory.getMemoryDir(), text);
      const promptText = threadContext
        ? `[Recent conversation]\n${threadContext}\n\n[Current message]\n${text}`
        : text;

      const { response } = await callClaude(promptText, context, 2, {
        source: 'foreground',
        onStreamChat,
        fgSlotId: slotId,
        triggerReason: 'room-foreground', // Use lighter system prompt tier for foreground
        rebuildContext: async (mode, budget) => {
          return memory.buildContext({ mode, contextBudget: budget ?? FG_CONTEXT_BUDGET });
        },
      });

      // Process all tags via unified postProcess (remember, delegate, inner, etc.)
      // Suppress chat sending — already streamed above via onStreamChat
      const result = await postProcess(text, response, {
        lane: 'foreground',
        duration: 0,
        source,
        systemPrompt: '',
        context: '',
        skipHistory: false,
        suppressChat: streamedChats.size > 0,
        cycleCount: this.cycleCount,
      });
      // Expire overdue commitments on foreground path too (OODA prompt build handles its own)
      try { expireOverdueCommitments(this.cycleCount); } catch { /* fire-and-forget */ }
      const answer = result.content || response;

      // Runtime escalation check — promote to task if foreground work exceeded thresholds
      if (escalation.shouldPromote()) {
        try {
          const memDir = getMemory().getMemoryDir();
          const taskId = await escalation.promote(source, text, memDir);
          const metrics = escalation.getMetrics();
          slog('LOOP', `[foreground] runtime escalation: promoted to task ${taskId} (reason=${metrics.reason}, elapsed=${metrics.elapsed}ms, steps=${metrics.stepCount})`);
          await writeRoomMessage('kuro', `[auto] 工作已轉為 background task tracking (${metrics.reason})`, replyTo);
        } catch (e) { slog('ERROR', `[foreground] escalation promote failed: ${e}`); }
      }

      // Quality gate — check output before delivery
      const gateResult = qualityCheck(answer, {
        source,
        inputLength: text.length,
        isCode: /```[\s\S]*```/.test(answer),
        lane: 'foreground',
      });
      if (!gateResult.pass) {
        slog('LOOP', `[foreground] quality gate failed: ${gateResult.issues.join('; ')}`);
      }

      // Send reply only if nothing was streamed (fallback for responses without <kuro:chat> tags)
      // Convergence guard: only emit when the model produced something a human can actually read.
      //   - Prefer parsed <kuro:chat> tag content (the model's intended user-visible text)
      //   - Allow pure plain text (no XML-like tags remain after stripping kuro tags)
      //   - REJECT anything containing residual tags like <reply_plan>, </system-reminder>, etc.
      //     These are model hallucinations / prompt-boundary leaks (#066 / #070 incidents).
      // Rejected responses leave the inbox pending so a later cycle can attempt a real reply.
      if (streamedChats.size === 0) {
        const parsedChats = parseTags(response).chats;
        let displayAnswer = '';

        if (parsedChats.length > 0) {
          displayAnswer = parsedChats.map(c => c.text).join('\n\n').trim();
        } else {
          const cleanAnswer = stripKuroTags(answer).trim();
          // Any remaining XML-like tag after stripKuroTags is suspect (kuro tags already gone,
          // so this is hallucinated structure). Block it from reaching the room.
          const hasResidualTag = /<\/?[a-z][a-z_-]*[\s>]/i.test(cleanAnswer);
          if (cleanAnswer && !hasResidualTag) {
            displayAnswer = cleanAnswer;
          } else if (hasResidualTag) {
            slog('LOOP', `[foreground:${slotId}] suppressed malformed response (residual tag, no <kuro:chat>): ${response.slice(0, 120).replace(/\n/g, ' ')}`);
            writeActivity({
              lane: 'foreground',
              summary: `[SUPPRESSED-MALFORMED] response had residual non-kuro tags, no chat — kept inbox pending`,
              trigger: source,
              tags: result.tagsProcessed,
            });
          }
        }

        if (displayAnswer) {
          if (source === 'telegram') {
            notifyTelegram(displayAnswer, matchReplyTarget(displayAnswer, telegramMsgs) ?? undefined).catch(() => {});
            clearLastReaction();
          }
          if (!opts?.quiet) {
            await writeRoomMessage('kuro', displayAnswer, replyTo);
          }
        } else if (parsedChats.length === 0) {
          slog('LOOP', `[foreground:${slotId}] no visible reply emitted for ${source} — message stays pending`);
        }
      } else if (source === 'telegram') {
        clearLastReaction();
      }

      // Record for next cycle awareness (supports multiple concurrent foreground replies)
      this.foregroundReplyRecords.push({ question: text, answer: answer.slice(0, 300), source, ts: new Date().toISOString(), tagsProcessed: result.tagsProcessed });
      this.hadForegroundActionThisCycle = true;

      // Log FG action to behavior log — makes FG successes visible in <action-memory>
      try { getLogger().logBehavior('agent', 'action.foreground', `[${source}] ${answer.slice(0, 500)}`); } catch { /* fire-and-forget */ }

      // ── Inbox marking — decoupled from commitment detection (#130 fix, #repetition-loop fix) ──
      // Design: inbox marking and commitment detection are INDEPENDENT concerns.
      // A visible reply to the user = inbox item is processed, period.
      // Unfulfilled commitments are logged separately for follow-up, never block inbox marking.
      // Previous design: commitment detection BLOCKED inbox marking → feedback loop where
      // "收到，我會..." matched commitment patterns → inbox stayed pending → mushi continuation
      // → foreground re-processed same item → 15+ identical "收到" messages.
      const responseTags = parseTags(response);
      try { markChatRoomInboxProcessed(response, responseTags, 'foreground-reply'); } catch { /* fire-and-forget */ }

      const FG_ACK_RE = /看到|收到|了解|好的|等下|馬上|稍後|讓我|先去|我來|我去|正在看|開始看|研究一下|仔細看/;
      const fgAllChats = [...streamedChats, ...responseTags.chats.map(c => c.text)];
      const fgHasSubstantiveChat = fgAllChats.length > 0
        && !fgAllChats.every(t => t.length < 80 && FG_ACK_RE.test(t));
      const hasVisibleReply = fgHasSubstantiveChat
        || responseTags.asks.length > 0
        || responseTags.shows.length > 0
        || responseTags.summaries.length > 0;
      const BOT_FROMS = new Set(['mushi', 'system', 'bot', 'kuro', 'kuro-watcher']);

      try {
        const pending = readPendingInbox().filter(i => i.source === source && i.status === 'pending');
        let suppressed = 0;
        let marked = 0;
        for (const item of pending) {
          const isBotSender = BOT_FROMS.has((item.from || '').toLowerCase());
          // Circuit breaker: after 2 foreground attempts without visible reply, force-mark
          // to prevent infinite retry loops. Track via foregroundRetryCount map.
          const retryCount = (this.foregroundRetryCount.get(item.id) ?? 0) + 1;
          this.foregroundRetryCount.set(item.id, retryCount);
          const forceMarkByRetry = retryCount >= 2;

          if (!isBotSender && !hasVisibleReply && !forceMarkByRetry) {
            suppressed++;
            continue;
          }
          if (forceMarkByRetry && !hasVisibleReply) {
            slog('LOOP', `[foreground:${slotId}] Circuit breaker: force-marking item ${item.id} after ${retryCount} attempts`);
          }
          queueInboxMark(item.id, 'replied');
          this.foregroundRetryCount.delete(item.id);
          marked++;
        }
        if (marked > 0) flushInboxMarks();
        if (suppressed > 0) {
          slog('LOOP', `[foreground:${slotId}] ⚠ ${suppressed} human inbox item(s) left pending — no visible reply (attempt ${[...this.foregroundRetryCount.values()].join(',')})`);
        }
      } catch { /* fire-and-forget */ }

      // Separate concern: log unfulfilled commitment for awareness (never blocks inbox marking)
      const COMMITMENT_PATTERNS = [
        /交給背景/,
        /背景(?:跑|讀|研究|深讀|深挖|挖)/,
        /(?:^|\s)delegate(?:\s|$)/i,
        /交給.*lane/i,
        /spawn.*tentacle/i,
      ];
      const hasDelegateTag = result.tagsProcessed?.includes('delegate') ?? false;
      const chatTexts = [...streamedChats].join(' ');
      if (streamedChats.size > 0 && !hasDelegateTag && COMMITMENT_PATTERNS.some(p => p.test(chatTexts))) {
        slog('LOOP', `[foreground:${slotId}] ⚠ Commitment language without delegate — noted for follow-up`);
      }

      // FG lane does NOT auto-mark tasks as complete.
      // Previous 80-char fuzzy matching caused false positives — unrelated tasks
      // were marked complete because short snippets matched too broadly.
      // Tasks are completed only by: explicit <kuro:done> tags or roomMsgId match.

      // Update lastAction so /status reflects foreground activity (visibility fix)
      this.lastAction = `[Foreground] Replied to ${source}: ${answer.slice(0, 100)}`;

      slog('LOOP', `[foreground:${slotId}] Replied to ${source} (${answer.length} chars)`);
      eventBus.emit('action:loop', { event: 'foreground-reply', source, answerLength: answer.length });
      writeActivity({
        lane: 'foreground',
        summary: `Replied to ${source}: ${answer.slice(0, 120)}`,
        trigger: source,
        tags: result.tagsProcessed,
      });
    } catch (err) {
      slog('ERROR', `[foreground:${slotId}] Failed: ${err instanceof Error ? err.message : err}`);
      // If chat was already streamed before crash, the user saw a response but actions may not have run.
      // Leave inbox unprocessed so main loop can follow up.
      if (streamedChats.size > 0) {
        slog('LOOP', `[foreground:${slotId}] ⚠ Crashed after streaming ${streamedChats.size} chat(s) — leaving inbox for main loop recovery.`);
      }
    } finally {
      // Always release the slot, message claim, and content hash, even on error
      releaseForegroundSlot(slotId);
      if (replyTo) releaseMessage(replyTo);
      this.activeForegroundHashes.delete(contentHash);
    }
  }

  /** Handle routed event when no cycle is running */
  private handleEventNotCycling(
    event: ReturnType<typeof createEvent>,
    decision: ReturnType<typeof router.route>,
    agentEvent: AgentEvent,
    now: number,
  ): void {
    if (decision.lane === 'deferred') {
      slog('LOOP', `[unified] Event deferred: ${event.source} (${decision.reason})`);
      return;
    }

    // Perception refresh events (mark-processed) should NOT trigger new cycles
    if (event.source === 'telegram' && agentEvent.data?.source === 'mark-processed') {
      return;
    }

    // Non-direct-message sources: respect min cycle interval
    if (!AgentLoop.DIRECT_MESSAGE_SOURCES.has(event.source) && now - this.lastCycleTime < AgentLoop.MIN_CYCLE_INTERVAL) {
      return;
    }

    // DM routing — all external messages always go to foreground lane (fast, focused response)
    // OODA cycles are reserved for autonomous deep thinking, not message replies.
    // Messages are batched per-source (3s window) to merge rapid-fire messages.
    const messageText = (agentEvent.data?.text as string) ?? '';
    if (AgentLoop.DIRECT_MESSAGE_SOURCES.has(event.source) && messageText) {
      const roomMsgId = (agentEvent.data?.roomMsgId as string) ?? undefined;
      if (roomMsgId && !claimMessage(roomMsgId, 'foreground')) {
        slog('LOOP', `[dedup] Skipping ${roomMsgId} in FG — already claimed`);
        return;
      }
      slog('LOOP', `[dm-route] ${event.source} → batch buffer`);
      this.batchBuffer.add(event.source, messageText, roomMsgId);
      return;
    }

    // If agent process is busy — only P0 (telegram-user) can preempt.
    // Lower priority events queue up and wait for the current work to finish.
    if (isLoopBusy()) {
      if (event.priority <= Priority.P0) {
        slog('LOOP', `[unified] Preempting busy state for ${event.source} (P${event.priority})`);
        preemptLoopCycle();
        setTimeout(() => {
          this.triggerReason = `${event.source} (unified)`;
          this.runCycle();
        }, 500);
      } else {
        slog('LOOP', `[unified] Busy — queuing ${event.source} (P${event.priority}), will run after current work`);
        this.directMessageWakeQueue++;
      }
      return;
    }

    // Build trigger reason
    const detail = Object.keys(agentEvent.data).length > 0
      ? `: ${JSON.stringify(agentEvent.data).slice(0, 100)}`
      : '';
    this.triggerReason = event.source === 'telegram' ? 'telegram-user' : `${event.source}${detail}`;

    this.runCycle();
  }

  /** Event handler — bound to `this` for subscribe/unsubscribe */
  private handleTrigger = (event: AgentEvent): void => {
    return this.handleUnifiedEvent(event);
  };


  constructor(config: Partial<AgentLoopConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentInterval = this.config.intervalMs;
    // BatchBuffer: merge rapid-fire DMs from same source into one foreground call
    this.batchBuffer = new BatchBuffer(
      (source, mergedText, replyTo) => this.executeForegroundCall(source, mergedText, replyTo).catch(() => {}),
      3000, // 3s window
    );
    // DelegationBatchBuffer: collect rapid delegation completions into one cycle (10s sliding window)
    this.delegationBatchBuffer = new DelegationBatchBuffer(
      (_taskIds, count) => {
        if (!this.running || this.paused) return;
        if (this.cycling) {
          slog('LOOP', `[delegation-batch] ${count} completions buffered but cycle running — flagging for post-cycle drain`);
          this.hasPendingDelegationResults = true;
          return;
        }
        slog('LOOP', `[delegation-batch] Flushing ${count} batched completion(s) → triggering single cycle`);
        this.triggerReason = `delegation-batch(${count})`;
        this.runCycle();
      },
      10_000, // 10s sliding window
    );
  }


  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  start(): void {
    if (!this.config.enabled) return;
    if (this.running) return;

    this.running = true;
    this.paused = false;

    // Initialize Shared Knowledge Bus
    try { initSharedKnowledge(getInstanceDir(getCurrentInstanceId())); } catch { /* best effort */ }

    // Agent OS: Initialize process table from disk
    try { initProcessTable(getMemoryStateDir()); } catch { /* best effort */ }

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

    // Phase 1d: Load work journal for restart resilience
    const journalEntries = loadWorkJournal(5);
    if (journalEntries.length > 0) {
      this.workJournalContext = formatWorkJournalContext(journalEntries);
      slog('JOURNAL', `Loaded ${journalEntries.length} work journal entries from previous instance`);
    }

    // Phase 1e: Restore pending priority events from WAL
    const walState = loadAndClearPendingState();
    if (walState?.pendingPriority) {
      this.pendingPriority = walState.pendingPriority;
      this.directMessageWakeQueue = walState.directMessageWakeQueue;
      slog('LOOP', `Restored pending priority from WAL: ${walState.pendingPriority.reason} (${walState.pendingPriority.messageCount} msg)`);
    }

    // Phase 1f: Load persistent memory from KG
    loadAgentMemory({ agent: getCurrentInstanceId() ?? '03bbc29a' }).then(memories => {
      this.kgMemory = memories;
      if (memories.length > 0) {
        slog('KG-MEMORY', `Loaded ${memories.length} memories from KG`);
      }
    }).catch(() => {
      slog('KG-MEMORY', 'KG unavailable, using file fallback');
    });

    // Recover forge worktree state (clean up crash state, prune stale worktrees)
    try { forgeRecover(process.cwd()); } catch { /* fire-and-forget */ }

    // Restore noopStreak from previous instance (survives restart)
    const health = loadLoopHealth();
    if (health) {
      this.noopStreak = health.noopStreak;
      this.trueNoopStreak = health.trueNoopStreak ?? 0;
    }

    // Achievement system: retroactive unlock on first boot
    import('./achievements.js').then(m => m.retroactiveUnlock()).catch(() => {});

    // Metabolism: initialize event listeners for pattern detection
    initMetabolism();

    // Sentinel: watch file-based event sources not covered by API handlers
    startSentinel(process.cwd());

    eventBus.on('trigger:*', this.handleTrigger);

    // Delegation complete → batch into DelegationBatchBuffer (10s sliding window)
    // Multiple rapid completions are collected and trigger ONE cycle to absorb all results.
    // Myelin routing + foreground tracking happen immediately (fire-and-forget, no batching needed).
    eventBus.on('action:delegation-complete', (event?: AgentEvent) => {
      // Clean up foreground delegation tracking when delegation completes
      const taskId = event?.data?.taskId as string | undefined;
      if (taskId) {
        clearForegroundDelegation(taskId);
        slog('LOOP', `[delegation-complete] Cleared foreground tracking for ${taskId}`);
      }

      // Myelin: route learn/research delegation results through learning crystallization
      const delegationType = event?.data?.type as string | undefined;
      if (delegationType === 'learn' || delegationType === 'research') {
        const outputPreview = event?.data?.outputPreview as string | undefined;
        import('./myelin-fleet.js').then(({ triageLearningEvent }) =>
          triageLearningEvent({
            source: 'delegation-complete',
            content: outputPreview ?? `${delegationType} delegation completed`,
            delegationType,
          }).catch(() => {}),
        ).catch(() => {}); // fire-and-forget

        // Research crystallization: extract structured patterns from delegation output
        if (taskId) {
          import('./delegation.js').then(({ getTaskResult }) => {
            const result = getTaskResult(taskId!);
            if (result?.status === 'completed' && result.output) {
              import('./small-model-research.js').then(({ processResearchResult }) => {
                processResearchResult(
                  result.output,
                  delegationType as 'learn' | 'research',
                  result.duration ?? 0,
                  result.confidence,
                );
              }).catch(() => {});
            }
          }).catch(() => {}); // fire-and-forget
        }
      }

      // KB: observe delegation completion (fire-and-forget)
      try {
        kbObserve({
          source: 'delegation', type: 'outcome',
          data: { taskId, delegationType: delegationType ?? 'unknown' },
          outcome: (event?.data?.status as string) === 'completed' ? 'success' : 'fail',
          durationMs: event?.data?.durationMs as number | undefined,
          tags: [delegationType ?? 'code'],
        });
      } catch { /* fire-and-forget */ }

      // L3 skill recording removed — consolidated into myelin-fleet.ts

      // Close task in memory-index + process table (prevents zombie in_progress accumulation)
      if (taskId) {
        const delegationStatus = (event?.data?.status as string) === 'completed' ? 'completed' : 'abandoned';
        import('./memory-index.js').then(({ updateMemoryIndexEntry }) => {
          const memDir = path.join(process.cwd(), 'memory');
          updateMemoryIndexEntry(memDir, taskId!, { status: delegationStatus }).catch(() => {});
        }).catch(() => {});
        try { completeProcess(taskId); } catch { /* may not exist in process table */ }
      }

      // Buffer the completion — DelegationBatchBuffer handles the 10s sliding window
      // and triggers a single cycle when the window expires
      slog('LOOP', `[delegation-complete] Buffering completion${taskId ? ` (${taskId})` : ''} (buffer size: ${this.delegationBatchBuffer.size + 1})`);
      this.delegationBatchBuffer.add(taskId);
    });

    // Run first cycle after short warmup (let perception streams initialize)
    // instead of waiting the full heartbeat interval
    const STARTUP_DELAY = 15_000; // 15s warmup
    setTimeout(() => {
      if (this.running && !this.paused && !this.cycling) {
        // Priority 1: WAL-restored pending priority → drain immediately
        if (this.pendingPriority) {
          const drainSource = this.pendingPriority.reason.startsWith('telegram') ? 'telegram-user' : this.pendingPriority.reason.split('-')[0];
          this.triggerReason = `${drainSource} (restored from WAL)`;
          slog('LOOP', `Startup: draining WAL-restored priority: ${this.pendingPriority.reason}`);
          // Clear pendingPriority — cycle will see inbox items directly via buildContext
          this.pendingPriority = null;
          this.directMessageWakeQueue = 0;
        }
        // Priority 2: Inbox has unprocessed P0/P1 items (safety net even without WAL)
        else if (getUnprocessedHighPriority(4).length > 0) {
          this.triggerReason = 'startup (unprocessed-P0/P1)';
          slog('LOOP', 'Startup: unprocessed P0/P1 inbox items detected → prioritizing');
        }
        // Priority 3: Legacy check for 'seen' telegram items
        else if (hasRecentUnrepliedTelegram(4)) {
          this.triggerReason = 'startup (telegram-hint)';
          slog('LOOP', 'Startup: recent unseen telegram detected → prioritizing inbox check');
        } else {
          this.triggerReason = 'startup';
        }
        this.runCycle();
      }
    }, STARTUP_DELAY);

    this.scheduleHeartbeat();
    eventBus.emit('action:loop', { event: 'start', detail: `Started (event-driven, first cycle in ${STARTUP_DELAY / 1000}s, dynamic interval: ${this.currentInterval / 1000}s)` });
  }

  stop(): void {
    // Persist pending priority to WAL before clearing (survives restart)
    if (this.pendingPriority) {
      savePendingState(this.pendingPriority, this.directMessageWakeQueue);
    }

    this.running = false;
    eventBus.off('trigger:*', this.handleTrigger);
    this.clearTimer();
    this.delegationBatchBuffer.flush(); // Drain pending delegation completions before shutdown
    this.pendingPriority = null;
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
    const gateStatsStr = formatGateStats();
    return {
      running: this.running,
      paused: this.paused,
      cycleCount: this.cycleCount,
      lastCycleAt: this.lastCycleAt,
      lastAction: this.lastAction,
      nextCycleAt: this.nextCycleAt,
      currentInterval: this.currentInterval,
      mode: this.currentMode,
      ...(this.pendingPriority ? {
        pendingPriority: { reason: this.pendingPriority.reason, waitingMs: Date.now() - this.pendingPriority.arrivedAt },
      } : {}),
      ...(gateStatsStr ? { omlxGate: gateStatsStr } : {}),
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

  private prevTrueNoopStreak = 0;

  private adjustInterval(hadAction: boolean): void {
    if (hadAction) {
      // Momentum reward: if breaking out of a noop spiral (3+ true noops → action),
      // cut interval to 60% of base to encourage sustained momentum.
      if (this.prevTrueNoopStreak >= 3 && this.trueNoopStreak === 0) {
        this.currentInterval = Math.round(this.config.intervalMs * 0.6);
        slog('LOOP', `[momentum] Noop spiral broken (was ${this.prevTrueNoopStreak}) — accelerating to ${Math.round(this.currentInterval / 1000)}s`);
      } else {
        this.currentInterval = this.config.intervalMs;
      }
    } else {
      // Dynamic idle cap: uniform ×2 (no night slowdown — agent is 24/7)
      const maxMultiplier = 2;
      const maxInterval = this.config.intervalMs * maxMultiplier;
      this.currentInterval = Math.min(
        this.currentInterval * this.config.idleMultiplier,
        maxInterval,
      );
    }

    // Hard cap: don't idle too long when there's work to do
    try {
      const memDir = path.join(process.cwd(), 'memory');
      if (this.currentInterval > 180_000 && hasP0Tasks(memDir)) {
        this.currentInterval = 180_000; // 3min cap for P0
        slog('LOOP', `[next-p0] Capping interval to 3min — memory-index has P0 items`);
      } else if (this.currentInterval > 1200_000) {
        // Cap at 20min when ANY tasks are pending — todo list exists to be done, not to idle
        const pendingTasks = getPendingTaskPreviews(memDir);
        if (pendingTasks.length > 0) {
          this.currentInterval = 1200_000; // 20min cap for P1/P2
          slog('LOOP', `[next-tasks] Capping interval to 20min — ${pendingTasks.length} pending task(s)`);
        }
      }
    } catch { /* non-critical */ }
  }

  /**
   * Check if there are unprocessed items that warrant faster cycling.
   * Different from concurrentInboxDetected: checks state AT cycle end,
   * not items that arrived during Claude call.
   */
  private hasPendingWork(): boolean {
    try {
      // Check chat room inbox
      if (fs.existsSync(CHAT_ROOM_INBOX_PATH)) {
        const content = fs.readFileSync(CHAT_ROOM_INBOX_PATH, 'utf-8');
        if (content.includes('## Unaddressed') && /## Unaddressed[\s\S]*?- \[/.test(content)) {
          return true;
        }
      }
      // Only P0/P1 tasks count as "pending work" — P2+ don't block learn/explore/idle
      const memDir = path.join(process.cwd(), 'memory');
      const highPriCount = getHighPriorityPendingCount(memDir);
      if (highPriCount > 0) {
        return true;
      }
      // Check overdue high-priority commitments — said it, now do it
      if (hasOverdueCommitments(this.cycleCount)) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private async runCycle(): Promise<void> {
    if (!this.running || (this.paused && !this.calmWake)) return;
    this.calmWake = false;

    // mushi triage — BEFORE updating lastCycleTime so lastThinkAgo reflects actual gap
    // DMs now go through triage (mushi classifies as quick/wake). Fail-open if mushi offline.
    // Placed here (not in handleEvent) so ALL cycle entry points are covered:
    // heartbeat timer, priority drain, direct-message queue, and event-driven triggers
    const reason = this.triggerReason ?? '';
    const isDM = [...AgentLoop.DIRECT_MESSAGE_SOURCES].some(s => reason.startsWith(s))
      || reason.startsWith('direct-message');
    const isContinuation = reason.startsWith('continuation');
    const hasP0 = this.hasPendingWork();
    // Noop spiral override: after 3+ consecutive TRUE empty cycles (zero tags),
    // pending work is clearly not addressable right now — stop bypassing triage.
    // Uses trueNoopStreak (not noopStreak) to avoid throttling productive-but-invisible cycles.
    const effectiveP0 = hasP0 && this.trueNoopStreak < 3;
    if (effectiveP0 && !isDM) {
      slog('MUSHI', `✅ P0 pending work bypasses triage (hard rule)`);
      logTriageBypass('P0-pending', 'wake', 'pending work exists');
    } else if (hasP0 && this.trueNoopStreak >= 3) {
      slog('MUSHI', `⚠️ P0 pending but trueNoopStreak=${this.trueNoopStreak} — triage not bypassed`);
    }
    // Log alert/delegation bypasses independently — NOT gated by hasP0 or mushi-triage flag
    if (!isContinuation && reason) {
      const bypassSrc = reason.split(/[:(]/)[0].trim();
      if (bypassSrc === 'alert') {
        logTriageBypass('alert', 'wake', 'alert always wakes');
      } else if (bypassSrc === 'delegation-complete' || bypassSrc === 'delegation-batch') {
        logTriageBypass(bypassSrc, 'wake', 'must absorb delegation results');
      }
    }
    if (isEnabled('mushi-triage') && !isContinuation && (!effectiveP0 || isDM) && reason) {
      const triageSource = reason.split(/[:(]/)[0].trim();
      if (triageSource === 'alert') {
        slog('MUSHI', `✅ alert bypasses triage (hard rule)`);
      } else if (triageSource === 'delegation-complete' || triageSource === 'delegation-batch') {
        slog('MUSHI', `✅ ${triageSource} bypasses triage (must absorb results)`);
      } else if (
        this.cycleCount > 1  // Never hard-skip first 2 cycles after restart — prevents idle loop from crash-resumed lastAction
        && (triageSource === 'heartbeat' || triageSource === 'workspace')
        && perceptionStreams.version === this.lastPerceptionVersion
        && this.lastAction && /no action|穩態|無需行動|nothing to do/i.test(this.lastAction)
        && (!this.hasPendingWork() || this.trueNoopStreak >= 3)
      ) {
        // Hard skip: routine trigger + no perception change + last cycle was idle + no P0 work
        // Noop spiral override: if 3+ consecutive empty cycles, skip even with pending work
        // Applies to heartbeat AND workspace — saves ~800ms mushi LLM call per skip
        // workspace: git diff detected a change but perception cache hasn't updated = minor/already-captured change
        // GUARD: never skip if memory-index has P0 items or inbox has unaddressed messages
        slog('MUSHI', `⏭ Hard skip — ${triageSource} + no perception change + idle`);
        logTriageBypass(triageSource, 'skip', 'no-perception-change + idle');
        try { kbObserve({ source: 'mushi', type: 'skip', data: { trigger: triageSource, reason: 'hard-rule: no-perception-change + idle' }, tags: [triageSource] }); } catch { /* fire-and-forget */ }
        writeTrailEntry({
          ts: new Date().toISOString(),
          agent: 'mushi',
          type: 'scout',
          decision: 'skip',
          topics: [triageSource],
          detail: `hard-rule: no-perception-change + idle`,
          decay_h: 24,
        });
        import('./context-optimizer.js').then(({ getContextOptimizer }) => {
          const opt = getContextOptimizer();
          opt.recordCycle({ citedSections: [] });
          opt.save();
        }).catch(() => {});
        this.lastCycleTime = Date.now();
        if (this.running && !this.paused) {
          this.scheduleHeartbeat();
        }
        return;
      } else {
        const triageCtx: TriageContext = {
          lastCycleTime: this.lastCompletedCycleTime || this.lastCycleTime,
          lastAction: this.lastAction,
          lastPerceptionVersion: this.lastPerceptionVersion,
          currentPerceptionVersion: perceptionStreams.version,
          perceptionChangedCount: perceptionStreams.getChangedCount(),
          cycleCount: this.cycleCount,
        };
        const decision = await mushiTriage(triageSource, { source: reason, detail: reason }, triageCtx, this.triggerMessageText ?? undefined);
        if (decision === 'skip') {
          slog('MUSHI', `⏭ Skipping cycle — trigger: ${triageSource}`);
          logTriageBypass(triageSource, 'skip', 'mushi-triage-llm');
          try { kbObserve({ source: 'mushi', type: 'skip', data: { trigger: triageSource, reason: 'mushi-triage' }, tags: [triageSource] }); } catch { /* fire-and-forget */ }
          // Trail: skip = scouting, not discarding. Record what was seen.
          writeTrailEntry({
            ts: new Date().toISOString(),
            agent: 'mushi',
            type: 'scout',
            decision: 'skip',
            topics: [triageSource],
            detail: `trigger: ${reason}; perceptionChanged: ${perceptionStreams.getChangedCount()}`,
            decay_h: 24,
          });
          // Count skipped cycles into context-optimizer (zero citations accelerates demotion)
          import('./context-optimizer.js').then(({ getContextOptimizer }) => {
            const opt = getContextOptimizer();
            opt.recordCycle({ citedSections: [] });
            opt.save();
          }).catch(() => {});
          this.lastCycleTime = Date.now(); // Update after triage to prevent rapid re-trigger
          if (this.running && !this.paused) {
            this.scheduleHeartbeat();
          }
          return;
        }
        if (decision === 'quick') {
          slog('MUSHI', `⚡ Quick cycle — trigger: ${triageSource}`);
          writeTrailEntry({
            ts: new Date().toISOString(),
            agent: 'mushi',
            type: 'scout',
            decision: 'quick',
            topics: [triageSource],
            detail: `trigger: ${reason}; perceptionChanged: ${perceptionStreams.getChangedCount()}`,
            decay_h: 24,
          });
          // Use foreground lane — focused context for quick cycle (quiet: no Chat Room unless explicit <kuro:chat>)
          const triggerText = `[Quick cycle — trigger: ${reason}] 這是輕量 cycle，用快取感知資料快速檢查。如有需要行動的事項就處理（用 tags），沒有就什麼都不說。不需要確認狀態、不需要完整 OODA 分析。`;
          await this.foregroundReply(triageSource, triggerText, undefined, { quiet: true });
          this.lastCycleTime = Date.now();
          if (this.running && !this.paused) {
            this.scheduleHeartbeat();
          }
          return;
        }
      }
    }

    // Sleep detection — skip Claude calls when machine appears suspended
    // All non-event-driven perceptions stale >5min = machine likely sleeping
    // Claude CLI would get SIGTERM'd (exit 143) anyway, so don't waste the call
    if (perceptionStreams.isMachineSleeping()) {
      slog('LOOP', `💤 Sleep detected — all perceptions stale >5min, skipping cycle`);
      this.currentInterval = 60_000; // poll every 1min for wake-up
      this.scheduleHeartbeat();
      return;
    }

    this.lastCycleTime = Date.now();

    try {
      await this.cycle();
      this.lastCompletedCycleTime = Date.now();
    } catch (err) {
      diagLog('loop.runCycle', err);
    }

    // Continuation check — mushi decides if we should immediately continue
    // Skip if: kuro:schedule already set, loop paused, mushi-triage disabled, or cycle was mesh-queued
    // Mesh-queued cycles didn't run Claude — no work was done, continuation is meaningless
    if (this.running && !this.paused && isEnabled('mushi-triage') && !this.lastCycleHadSchedule) {
      if (Date.now() < this.continuationCooldownUntil) {
        // In cooldown after hitting cap — skip continuation check entirely
        this.consecutiveContinuations = 0;
      } else if (this.consecutiveContinuations >= AgentLoop.MAX_CONSECUTIVE_CONTINUATIONS) {
        slog('MUSHI', `🔄 continuation capped (${AgentLoop.MAX_CONSECUTIVE_CONTINUATIONS} consecutive), cooldown 5min`);
        this.consecutiveContinuations = 0;
        this.continuationCooldownUntil = Date.now() + 5 * 60_000;
      } else {
        const contCtx: ContinuationContext = { lastAction: this.lastAction, triggerReason: this.triggerReason };
        const result = await mushiContinuationCheck(contCtx);
        if (result?.shouldContinue) {
          this.consecutiveContinuations++;
          // Set short interval (30s) for continuation
          this.currentInterval = 30_000;
          eventBus.emit('trigger:continuation', {
            consecutive: this.consecutiveContinuations,
            deep: result.deep,
          });
          slog('MUSHI', `🔄 continuation #${this.consecutiveContinuations} — scheduling 30s`);
        } else {
          this.consecutiveContinuations = 0;
        }
      }
    } else {
      this.consecutiveContinuations = 0;
    }

    // Concurrent inbox override — highest priority interval adjustment
    // Applies AFTER adjustInterval + kuro:schedule + continuation check
    // Only if Kuro didn't explicitly set a schedule (respect Kuro's intent)
    if (this.concurrentInboxDetected && !this.lastCycleHadSchedule) {
      this.currentInterval = 30_000;
      slog('LOOP', `[concurrent-inbox] Overriding interval to 30s for pending inbox items`);
    }

    // Pending work detection — cap interval when unprocessed items still exist
    // Different from concurrentInbox: checks state AT cycle end, not during Claude call
    // Priority: kuro:schedule > concurrent-inbox (30s) > pending-work (2min) > adjustInterval
    // Noop spiral guard: if 3+ consecutive empty cycles, pending work is not actionable right now
    if (!this.lastCycleHadSchedule && !this.concurrentInboxDetected
        && this.currentInterval > 120_000 && this.trueNoopStreak < 3) {
      if (this.hasPendingWork()) {
        this.currentInterval = 120_000; // 2min cap
        slog('LOOP', `[pending-work] Capping interval to 2min — unprocessed items detected`);
      }
    }

    // Noop spiral backoff: force minimum interval proportional to TRUE noop streak.
    // Uses trueNoopStreak (zero tags) to avoid throttling productive-but-invisible cycles.
    if (this.trueNoopStreak >= 3 && !this.lastCycleHadSchedule) {
      const noopFloor = Math.min(this.trueNoopStreak * 120_000, 600_000);
      if (this.currentInterval < noopFloor) {
        this.currentInterval = noopFloor;
        slog('LOOP', `[noop-backoff] Floor ${Math.round(noopFloor / 1000)}s (trueNoop=${this.trueNoopStreak})`);
      }
    }

    if (this.running && !this.paused) {
      this.scheduleHeartbeat();
    }
  }

  // ---------------------------------------------------------------------------
  // Concurrent Tasks — run during callClaude await (Phase 2)
  // ---------------------------------------------------------------------------

  /**
   * Read-only + housekeeping tasks that run in parallel with callClaude().
   * perception refresh, autoCommit+autoPush of previous cycle's changes.
   * Returns count of new inbox items detected during execution.
   */
  private async runConcurrentTasks(): Promise<number> {
    // Profile each concurrent task — they run in parallel with callClaude,
    // so any one of them hanging stretches the "await Promise.all" even when
    // callClaude completes quickly. A slow git push / metabolism regex /
    // perception refresh can silently dominate cycle duration.
    const tStart = Date.now();
    const timings: Record<string, number> = {};
    const time = async <T>(label: string, p: Promise<T>): Promise<T | undefined> => {
      const t0 = Date.now();
      try {
        const result = await p;
        timings[label] = Date.now() - t0;
        return result;
      } catch {
        timings[label] = Date.now() - t0;
        return undefined;
      }
    };

    const tasks: Promise<unknown>[] = [];

    // 1. Perception refresh — all streams get fresh caches
    tasks.push(time('perception', perceptionStreams.refreshAll()));

    // 2. Auto-commit + auto-push (previous cycle's leftover changes)
    if (isEnabled('auto-commit')) {
      tasks.push(time('autoCommit', autoCommitMemoryFiles(null)
        .then(() => {
          try { getMemory().updateConversationSearchIndex(); } catch { /* best effort */ }
        })
        .then(() => autoCommitExternalRepos())
        .then(() => {
          if (isEnabled('auto-push')) {
            return autoPushIfAhead().catch(() => {});
          }
        })
      ));
    }

    // 3. Metabolism — 新陳代謝掃描（吸收/排泄/偵測，各自自帶節流）
    tasks.push(time('metabolism', metabolismScan()));

    await Promise.allSettled(tasks);

    const totalMs = Date.now() - tStart;
    if (totalMs > 500) {
      const parts = Object.entries(timings).map(([k, v]) => `${k}=${v}ms`).join(' ');
      slog('PROFILE', `concurrentTasks total=${totalMs}ms ${parts}`);
    }

    // 3. Inbox pre-check — detect new items that arrived during Claude thinking
    try {
      return readPendingInbox().length;
    } catch {
      return 0;
    }
  }

  // ---------------------------------------------------------------------------
  // Core Cycle — Task Mode + Autonomous Mode
  // ---------------------------------------------------------------------------

  private async cycle(): Promise<string | null> {
    if (this.cycling) return null;
    this.cycling = true;
    this.concurrentInboxDetected = false;
    this.hadForegroundActionThisCycle = false;
    const logger = getLogger();
    const cycleStartTs = performance.now();
    const cycleStartWallTime = Date.now();

    try {
      this.cycleCount++;
      this.lastCycleAt = new Date().toISOString();

      eventBus.emit('action:loop', { event: 'cycle.start', cycleCount: this.cycleCount });

      // ── Inbox recovery: upgrade to DM-priority if pending DM items exist ──
      // Defense-in-depth: catches edge cases where trigger didn't start the cycle
      // (e.g. arrived during pause, process restart, or any future routing bug).
      // Must run before isDirectMessage so all downstream checks see the correct value.
      const inboxItemsEarly = readPendingInbox();

      // ── Task Graph: intelligent inbox routing ──
      // Route DM items: simple ones → foreground slots (parallel), complex → stay in OODA
      const dmItems = inboxItemsEarly.filter(i => AgentLoop.DIRECT_MESSAGE_SOURCES.has(i.source));
      // Layer 1: Track FG-claimed message IDs to prevent main loop re-processing
      const fgClaimedIds = new Set<string>();
      if (dmItems.length > 0) {
        const routingDecisions = routeInboxItems(dmItems);
        const fgItems = routingDecisions.filter(d => d.lane === 'foreground');
        const oodaItems = routingDecisions.filter(d => d.lane === 'ooda');

        // Fan out foreground-routed items to parallel slots (fire-and-forget)
        // Two dedup mechanisms:
        //   1. mergeable signal: same-batch items from same sender get folded
        //   2. active FG check: skip if FG already handling message from same sender
        const activeFgSenders = new Set<string>();
        try {
          const lanes = getLaneStatus();
          for (const slot of lanes.foreground.slots) {
            if (slot.task?.prompt) {
              // Extract sender from prompt (messages start with @kuro or contain sender info)
              const senderMatch = slot.task.prompt.match(/^\((\w+)\)/);
              if (senderMatch) activeFgSenders.add(senderMatch[1]);
              // Also mark source-based dedup
              activeFgSenders.add(`_slot_${slot.id}`);
            }
          }
        } catch { /* best effort */ }

        for (const decision of fgItems) {
          const item = decision.item;
          const sender = item.from || item.source;
          const itemMsgId = item.meta?.roomMsgId;

          // Guard: skip if already claimed by event-driven FG path (prevents duplicate FG lanes)
          if (itemMsgId && isMessageClaimed(itemMsgId)) {
            slog('TASK-GRAPH', `Inbox route: ${item.id} → SKIPPED (already claimed: ${itemMsgId})`);
            fgClaimedIds.add(item.id);
            queueInboxMark(item.id, 'seen');
            continue;
          }

          // Claim BEFORE batchBuffer.add — was after (L1467), causing race with event-driven path
          if (itemMsgId) claimMessage(itemMsgId, 'foreground');

          // Dedup: if mergeable OR if FG already has a lane for this sender+source, fold instead of new lane
          const shouldMerge = decision.mergeable || activeFgSenders.has(sender);

          if (shouldMerge) {
            slog('TASK-GRAPH', `Inbox route: ${item.id} → foreground MERGED (${decision.reason}, ${decision.mergeable ? `mergeable into ${decision.mergeable}` : `sender ${sender} already in FG`})`);
            // Append to existing batch buffer — will be merged with ongoing FG content
            this.batchBuffer.add(item.source, `\n---\n${item.content}`);
          } else {
            slog('TASK-GRAPH', `Inbox route: ${item.id} → foreground (${decision.reason})`);
            triageRouting({
              type: 'route', taskType: 'reply', prompt: item.content,
              complexity: 'low', isTechnical: false,
            }).catch(() => {});
            this.batchBuffer.add(item.source, item.content);
            activeFgSenders.add(sender); // prevent subsequent items from same sender opening new lanes
          }

          fgClaimedIds.add(item.id);
          queueInboxMark(item.id, 'seen');
        }
        if (fgItems.length > 0) {
          flushInboxMarks(); // Flush claims immediately — don't wait for cycle end
          slog('TASK-GRAPH', `Routed ${fgItems.length} inbox items to foreground (claimed), ${oodaItems.length} stay in OODA`);
        }
      }

      // Layer 2: Inbox recovery filters out FG-claimed items to prevent trigger upgrade
      if (!this.triggerReason?.startsWith('telegram-user') && !this.triggerReason?.startsWith('room') && !this.triggerReason?.startsWith('chat')) {
        const nonFgInbox = inboxItemsEarly.filter(i => !fgClaimedIds.has(i.id));
        const dmItem = nonFgInbox.find(i => AgentLoop.DIRECT_MESSAGE_SOURCES.has(i.source));
        if (dmItem) {
          if (dmItem.source === 'telegram') {
            this.triggerReason = 'telegram-user (inbox-recovery)';
          } else {
            this.triggerReason = `${dmItem.source} (inbox-recovery)`;
          }
          slog('LOOP', `Inbox recovery: pending ${dmItem.source} items detected → upgrading to DM-priority`);
        }
      }

      // ── Per-perception change detection (Phase 4) ──
      // Direct messages (telegram, room, chat) and cron bypass this check — must never be skipped
      const currentVersion = perceptionStreams.version;
      const isTelegramUser = this.triggerReason?.startsWith('telegram-user') ?? false;
      const isDirectMessage = isTelegramUser
        || this.triggerReason?.startsWith('room') || this.triggerReason?.startsWith('chat')
        || this.triggerReason?.startsWith('direct-message');
      const isCronTrigger = this.triggerReason?.startsWith('cron') ?? false;
      if (!isDirectMessage && !isCronTrigger && perceptionStreams.isActive() && currentVersion === this.lastPerceptionVersion) {
        eventBus.emit('action:loop', { event: 'cycle.skip', cycleCount: this.cycleCount });
        return null;
      }
      const perceptionChanged = currentVersion !== this.lastPerceptionVersion;
      this.lastPerceptionVersion = currentVersion;

      // ── Observe ──
      const memory = getMemory();

      // Phase 0: 0.8B concurrent preprocessing (perception summaries + heartbeat diff)
      // Runs before buildContext so Claude receives compressed context.
      // Skip for: DM (speed), heartbeat with no perception changes (no new data to summarize).
      let phase0Results: Phase0Results | undefined;
      const isRoutineHeartbeat = (this.triggerReason ?? '').includes('heartbeat') && !perceptionChanged;
      if (!isDirectMessage && !isRoutineHeartbeat) {
        try {
          phase0Results = await timed(`cycle#${this.cycleCount}.phase0`, () => runPhase0(), { alwaysLog: true });
        } catch (err) {
          // Fail-open: Phase 0 failure = buildContext uses raw data
          eventBus.emit('log:info', { tag: 'preprocess', msg: `Phase 0 failed (fail-open): ${err instanceof Error ? err.message : err}` });
        }
      }

      // Adaptive Cycle Depth: infer context weight from trigger + state
      const rawContextMode = this.inferCycleWeight(this.triggerReason ?? '', {
        hasNewInbox: inboxItemsEarly.length > 0,
        perceptionChanged,
      });
      const contextMode = rawContextMode;
      // Context budget: let the profile system (omlx-gate.ts) decide.
      // Previously: hardcoded systemPromptEstimate=25K (stale — actual: Tier0=1.3K, Tier1=2-5K, Tier2=9K)
      // → contextBudget=8K → overrode profile budgets (heartbeat=18K, autonomous=32K) → over-trimmed context.
      // Now: pass undefined to let buildContext use profileConfig.contextBudget as the primary control.
      const contextBudget = undefined;

      let context = await timed(
        `cycle#${this.cycleCount}.buildContext`,
        () => memory.buildContext({ mode: contextMode, cycleCount: this.cycleCount, trigger: this.triggerReason ?? undefined, phase0Results, contextBudget }),
        { alwaysLog: true },
      );

      // Constraint Texture: stale task pressure (grows with staleness)
      if (this.staleTasks.length > 0) {
        const staleLines = this.staleTasks.map(t => {
          const urgency = t.ticks > 8 ? '🔴 CRITICAL' : t.ticks > 5 ? '🟠 ESCALATED' : '⚠️ STALE';
          return `${urgency}: ${t.summary} — ${t.ticks} cycles without progress. Act now.`;
        });
        context = `<stale-tasks priority="top">\n${staleLines.join('\n')}\n</stale-tasks>\n\n` + context;
      }


      // Task Pull: idle/heartbeat cycles get a suggested next action from task queue
      if (isRoutineHeartbeat && !isDirectMessage) {
        const memDir = path.join(process.cwd(), 'memory');
        const pending = queryMemoryIndexSync(memDir, { type: ['task', 'goal'], status: ['pending', 'in_progress'] });
        const adHocOnly = pending.filter(t => !(t.payload as Record<string, unknown>)?.goal_id);
        const sorted = adHocOnly.sort((a, b) => {
          const pa = (a.payload as Record<string, unknown>)?.priority as number ?? 5;
          const pb = (b.payload as Record<string, unknown>)?.priority as number ?? 5;
          return pa - pb;
        });
        const top = sorted[0];
        if (top) {
          const ticks = (top.payload as Record<string, unknown>)?.ticksSinceLastProgress as number ?? 0;
          const goalId = (top.payload as Record<string, unknown>)?.goal_id as string ?? '';
          const goalHint = goalId ? ' (pipeline task)' : '';
          context = `<next-action type="pull">\n建議下一步：${top.summary?.slice(0, 150)}${goalHint} (priority: P${(top.payload as Record<string, unknown>)?.priority ?? '?'}, stale: ${ticks} ticks)\n推進這個 task — 做一個具體的、可驗證的進展。\n</next-action>\n\n` + context;
        }
      }

      // Append KG persistent memory to context (if loaded)
      if (this.kgMemory.length > 0) {
        const kgSection = formatMemorySection(this.kgMemory);
        if (kgSection) context += `\n\n<kg-memory>\n${kgSection}\n</kg-memory>`;
      }

      // Context snapshot for cross-instance awareness (fire-and-forget)
      writeContextSnapshot(this.cycleCount, context.length, contextMode).catch(() => {});

      // oMLX Gate R4: Context delta detection — skip autonomous cycles with unchanged context
      // Bypass R4 when there's known pending work. The system already detects pending work
      // (chat-room Unaddressed / pending tasks / overdue commitments) and uses it to cap
      // the interval; R4 must respect the same signal or it traps cycles in a skip loop
      // when Kuro committed to follow-up but produced no new context delta yet. Without this
      // bypass, "下個 cycle 給完整 review" promises silently die: 5+ consecutive R4 skips
      // observed in production while [pending-work] cap was actively firing.
      const hasPending = this.hasPendingWork();
      const inNoopSpiral = this.trueNoopStreak >= 3;
      if (!isDirectMessage && !isCronTrigger && !hasPending && !inNoopSpiral && !hasContextChanged(context)) {
        this.currentMode = 'idle';
        this.adjustInterval(false);
        slog('LOOP', `[omlx-gate] R4: Context unchanged, skipping cycle ${this.cycleCount}`);
        eventBus.emit('action:loop', { event: 'context-delta-skip', cycleCount: this.cycleCount });
        return null;
      }

      // oMLX Gate R8: Compute context hash for response caching (store after Claude call)
      const contextHash = hashContext(context);

      // Knowledge Bus summary — inject real-time cross-component patterns (fire-and-forget)
      try {
        const kbSummary = getKnowledgeSummary();
        if (kbSummary) context += `\n\n<knowledge-bus>\n${kbSummary}\n</knowledge-bus>`;
      } catch { /* best effort */ }

      // Lane awareness — show what FG lanes are doing, with file-level coordination
      try {
        const lanes = getLaneStatus();
        const lines: string[] = [];
        const claimedFiles: string[] = [];
        for (const s of lanes.foreground.slots) {
          if (!s.task) continue;
          const files = s.task.recentFiles;
          const fileStr = files.length > 0 ? ` [files: ${files.map(f => f.split('/').pop()).join(', ')}]` : '';
          lines.push(`FG ${s.id.slice(0, 8)}: ${s.task.prompt.slice(0, 120)}${fileStr}`);
          claimedFiles.push(...files);
        }
        // Layer 3: Annotate FG-claimed message IDs to prevent OODA from re-responding
        if (fgClaimedIds.size > 0) {
          lines.push(`\n⚠ FG lanes 已 claim 以下訊息，請勿重複回覆：${[...fgClaimedIds].join(', ')}`);
        }
        if (lines.length > 0) {
          let section = '<active-lanes>\n以下 foreground lane 正在同時工作：\n' + lines.join('\n');
          if (claimedFiles.length > 0) {
            section += `\n\n⚠ 這些檔案正被 foreground lane 編輯，請勿修改：${[...new Set(claimedFiles)].map(f => f.split('/').pop()).join(', ')}`;
          }
          section += '\n\n協作原則：任務相關時，選擇互補的部分（例如他做 UI 你做 API，他做結構你做樣式）。不相關則各自進行。';
          section += '\n</active-lanes>';
          context += `\n\n${section}`;
        }
      } catch { /* best effort */ }

      const hasAlerts = context.includes('ALERT:');
      if (hasAlerts) {
        eventBus.emit('trigger:alert', { cycle: this.cycleCount });
      }

      // ── Perception-first: no mode gate ──
      // Cooldown (only when behavior.md explicitly sets it)
      if (this.autonomousCooldown > 0 && !isDirectMessage && !isCronTrigger) {
        this.autonomousCooldown--;
        this.currentMode = 'idle';
        this.adjustInterval(false);
        logger.logCron('loop-cycle', 'Autonomous cooldown', 'agent-loop');
        eventBus.emit('action:loop', { event: 'cooldown', cycleCount: this.cycleCount, remaining: this.autonomousCooldown });
        return null;
      }

      // Active hours (only blocks non-triggered cycles)
      if (!isDirectMessage && !isCronTrigger && !this.isWithinActiveHours()) {
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
      this.triggerMessageText = null;

      // Reasoning Continuity: inject last 3 cycles' reasoning into prompt
      const reasoningHistory = loadReasoningHistory(3);
      const reasoningSection = formatReasoningContext(reasoningHistory);
      const previousCycleSuffix = reasoningSection
        ? `\n\n${reasoningSection}`
        : (this.previousCycleInfo ? `\n\nPrevious cycle: ${this.previousCycleInfo}` : '');

      // Phase 1b+1c: Inject interrupted cycle context (one-shot)
      const interruptedReason = this.interruptedCycleInfo?.includes('timeout') ? 'timed out — 拆成更小的步驟'
        : this.interruptedCycleInfo?.includes('process restart') ? 'process restart'
        : 'preempted by user message';
      const interruptedSuffix = this.interruptedCycleInfo
        ? `\n\nYour previous cycle was interrupted (${interruptedReason}). You were doing: ${this.interruptedCycleInfo}. Continue if relevant, but break into smaller steps.`
        : '';
      this.interruptedCycleInfo = null; // one-shot: 用完即清

      // Foreground Reply records: parallel replies sent during the previous cycle (supports concurrent)
      let foregroundReplySuffix = '';
      if (this.foregroundReplyRecords.length > 0) {
        const fgLines = this.foregroundReplyRecords.map(r => {
          const tagInfo = r.tagsProcessed?.length ? ` Tags: [${r.tagsProcessed.join(', ')}].` : '';
          return `- ${r.source}: "${r.question.slice(0, 150)}" → "${r.answer.slice(0, 150)}"${tagInfo}`;
        }).join('\n');
        foregroundReplySuffix = `\n\nDuring your previous cycle, ${this.foregroundReplyRecords.length} message(s) were answered via foreground lane (parallel, independent):\n${fgLines}\nOnly follow up if you have something substantive to add.`;
        this.foregroundReplyRecords = []; // one-shot: drain all
        this.hadForegroundActionThisCycle = true; // carry forward for noop counter
      }

      // Rule-based triage from unified inbox（零 LLM 成本）
      // Re-use inboxItemsEarly — already read above for inbox-recovery check
      const inboxItems = inboxItemsEarly;

      // Check memory-index for pending tasks BEFORE mode detection
      // Fix: mode detection must know about tracked tasks, not just inbox items
      const memDir = path.join(process.cwd(), 'memory');
      let hasPendingTasks = false;
      try {
        const pendingPreviews = getPendingTaskPreviews(memDir);
        hasPendingTasks = pendingPreviews.length > 0;
      } catch { /* non-critical */ }
      const hasHighPriorityTasks = getHighPriorityPendingCount(memDir) > 0;

      const cycleIntent = detectModeFromInbox(inboxItems, currentTriggerReason, { hasPendingTasks });

      // Priority prefix: 強制先處理 memory-index pending items 或 Chat Room priority 訊息
      const isTelegramUserCycle = currentTriggerReason?.startsWith('telegram-user') ?? false;
      const isRoomPriorityCycle = currentTriggerReason?.startsWith('room') ?? false;
      const isChatPriorityCycle = currentTriggerReason?.startsWith('chat') ?? false;
      // Re-use memDir and pending tasks from mode detection above (avoid duplicate query)
      let nextPendingItems: string[] = [];
      try {
        nextPendingItems = getPendingTaskPreviews(memDir);
      } catch { /* non-critical */ }

      // Priority prefix 在 telegram-user 或 room cycle 觸發
      let priorityPrefix = '';
      if (isTelegramUserCycle) {
        if (nextPendingItems.length > 0) {
          const itemsPreview = nextPendingItems.slice(0, 3).map(i => `  「${i.slice(0, 80)}」`).join('\n');
          priorityPrefix = `Alex 傳了訊息給你：\n${itemsPreview}\n\n收斂條件：這個 cycle 結束時，Alex 的訊息被理解了嗎？需要的行動被啟動了嗎？\n- 有實質回應就用 <kuro:chat> 說。沒有想法不要硬擠「收到」\n- 回答前自問：我描述的是症狀還是根因？有什麼證據會推翻我的結論？\n\n`;
        } else {
          priorityPrefix = `Alex 傳了訊息給你。檢查 <inbox> 確認內容。\n收斂條件：Alex 的需求被回應了嗎？\n\n`;
        }
      } else {
        // Non-telegram cycle: check for pending/unaddressed messages
        // DM-triggered cycles (room/chat) get strong priority; other cycles get soft reminder
        try {
          const inboxContent = fs.existsSync(CHAT_ROOM_INBOX_PATH)
            ? fs.readFileSync(CHAT_ROOM_INBOX_PATH, 'utf-8') : '';
          const pendingLines = inboxContent.match(/## Pending\n([\s\S]*?)(?=## (?:Unaddressed|Processed))/)?.[1]
            ?.split('\n').filter(l => l.startsWith('- [')) ?? [];
          const unaddressedLines = inboxContent.match(/## Unaddressed\n([\s\S]*?)(?=## Processed)/)?.[1]
            ?.split('\n').filter(l => l.startsWith('- [')) ?? [];
          // Filter out messages already claimed by FG lane (prevents duplicate processing)
          const extractMsgId = (line: string) => line.match(/\[(\d{4}-\d{2}-\d{2}-\d+)\]/)?.[1];
          const allPending = [...pendingLines, ...unaddressedLines]
            .filter(l => { const id = extractMsgId(l); return !id || !isMessageClaimed(id); });
          if (allPending.length > 0) {
            const preview = allPending.slice(0, 5).map(l => `  ${l}`).join('\n');
            if (isRoomPriorityCycle || isChatPriorityCycle) {
              // Room/chat-triggered: strong priority (same urgency as telegram)
              const sourceLabel = isChatPriorityCycle ? 'CLAUDE CODE MESSAGE' : 'CHAT ROOM MESSAGE';
              priorityPrefix = `${sourceLabel} 觸發了這個 cycle。\n\nChat Room 待回覆訊息：\n${preview}\n\n收斂條件：對方的問題被回答了嗎？有實質內容就用 <kuro:chat> 回覆。\n\n`;
            } else {
              // Fix 5: Check if any unaddressed messages are from Alex — these get strong priority even on non-DM cycles
              const hasAlexUnaddressed = allPending.some(l => /\(alex\)/.test(l));
              if (hasAlexUnaddressed) {
                // Alex's unaddressed messages override autonomous activities
                priorityPrefix = `Alex 有未回覆的訊息。Alex 的對話優先於自主任務。\n\nChat Room 待回覆訊息：\n${preview}\n\n收斂條件：Alex 的訊息被理解並回應了嗎？\n\n`;
              } else {
                // Other cycles (heartbeat/workspace/cron): soft reminder for unaddressed messages
                priorityPrefix = `📩 REMINDER: There are ${allPending.length} unaddressed Chat Room message(s). Please respond with <kuro:chat>...</kuro:chat> before or during your autonomous activities.\n\n${preview}\n\n`;
              }
            }
          }
        } catch { /* non-critical */ }

      }

      // Fix 3: Pending foreground delegations — OODA must follow up, not reflect/learn
      const pendingFgDelegations = getPendingForegroundDelegations();
      if (pendingFgDelegations.length > 0) {
        const fgPreview = pendingFgDelegations.map(d =>
          `  - [${d.source}] "${d.text.slice(0, 120)}" (delegated at ${new Date(d.delegatedAt).toLocaleTimeString()})`
        ).join('\n');
        priorityPrefix += `\n有背景委派待跟進。檢查 <background-completed> 看結果是否回來了。\n${fgPreview}\n收斂條件：委派的結果被吸收了嗎？原始發問者得到回覆了嗎？\n\n`;
      }

      // P0 reminder — applies to ALL triggers, not just non-telegram
      const p0Previews = getP0TaskPreviews(memDir);
      if (p0Previews.length > 0) {
        const p0Preview = p0Previews.slice(0, 3).map(i => `  「${i.slice(0, 100)}」`).join('\n');
        priorityPrefix += `\n⚠️ P0 items pending. These are your highest priority — address before starting new work:\n${p0Preview}\n\n`;
      }

      // ── Agent OS Scheduler: deterministic task selection ──
      const schedulerEvents: SchedulerEvent[] = [];
      if (isTelegramUserCycle) schedulerEvents.push({ source: 'telegram', priority: 0, isAlexDirectMessage: true });
      else if (isRoomPriorityCycle) schedulerEvents.push({ source: 'room', priority: 0, isAlexDirectMessage: false });
      else if (currentTriggerReason?.startsWith('cron')) schedulerEvents.push({ source: 'cron', priority: 2, isAlexDirectMessage: false });
      else schedulerEvents.push({ source: 'heartbeat', priority: 3, isAlexDirectMessage: false });

      advanceTick();
      const schedulerDecision = schedulerPick(memDir, schedulerEvents);

      // Handle suspend if scheduler preempted a task
      if (schedulerDecision.suspended) {
        const si = schedulerDecision.suspended;
        suspendProcess(si.taskId, si, '');
        saveSuspendCheckpoint({
          taskId: si.taskId,
          suspendedAt: new Date().toISOString(),
          reason: si.reason,
          resumeHints: '',
          priorityAtSuspend: si.priorityAtSuspend,
        });
        slog('SCHED', `suspended ${si.taskId.slice(0, 12)} (${si.reason})`);
      }

      // Handle resume — load checkpoint for context
      let schedulerTaskPrefix = '';
      if (schedulerDecision.taskId) {
        const resumeCheckpoint = loadSuspendCheckpoint(schedulerDecision.taskId);
        if (resumeCheckpoint && schedulerDecision.action === 'switch') {
          clearSuspendCheckpoint(schedulerDecision.taskId);
          resumeProcess(schedulerDecision.taskId);
          schedulerTaskPrefix = `\n\n<current-task binding="scheduler">\n📌 SCHEDULER ASSIGNED TASK (resume from suspend):\nTask: ${schedulerDecision.taskId}\nSuspend reason: ${resumeCheckpoint.reason}\nResume hints: ${resumeCheckpoint.resumeHints || 'none'}\nAction: ${schedulerDecision.reason}\n\n你的這個 cycle 專注執行這個 task。完成用 <kuro:done>，卡住用 <kuro:blocked>。\n</current-task>\n`;
        } else {
          const taskEntry = nextPendingItems.find(i => i.includes(schedulerDecision.taskId!.slice(0, 12)));
          const taskLabel = taskEntry ?? schedulerDecision.reason;
          incrementTicks(schedulerDecision.taskId);
          schedulerTaskPrefix = `\n\n<current-task binding="scheduler">\n📌 SCHEDULER ASSIGNED TASK:\nTask: ${taskLabel}\nAction: ${schedulerDecision.action} — ${schedulerDecision.reason}\n\n你的這個 cycle 專注執行這個 task。完成用 <kuro:done>，卡住用 <kuro:blocked>。不要切換到其他 task。\n</current-task>\n`;
        }
      } else if (schedulerDecision.action === 'discovery') {
        schedulerTaskPrefix = `\n\n<current-task binding="discovery-slot">\n🔍 DISCOVERY SLOT: This cycle is free exploration. You may investigate new opportunities, review pending items, or pursue serendipitous findings. No specific task binding.\n</current-task>\n`;
      }
      // Agent OS: Learning feedback — success hints + failure warnings
      if (schedulerDecision.taskId) {
        try {
          const taskSummary = schedulerDecision.reason;
          const successHint = buildSuccessHint(taskSummary);
          if (successHint) schedulerTaskPrefix += successHint;
          const failureMatch = matchFailure(taskSummary);
          if (failureMatch) {
            schedulerTaskPrefix += `\n<failure-warning frequency="${failureMatch.frequency}">\n⚠️ 類似任務曾失敗 ${failureMatch.frequency} 次：${failureMatch.pattern}\n上次：${failureMatch.context.slice(0, 100)}\n</failure-warning>\n`;
          }
        } catch { /* non-critical */ }
      }

      // Sync process table with memory-index tasks and persist
      try {
        const ptEntries = queryMemoryIndexSync(memDir, {
          type: ['task', 'goal'],
          status: ['pending', 'in_progress'],
        });
        syncFromTasks(ptEntries.map(entryToSnapshot), schedulerDecision.taskId);
        persistProcessTable();
      } catch { /* non-critical */ }
      slog('SCHED', getSchedulerStatus());

      // Agent OS: Reactive policies (starvation/zombie/hung)
      try {
        const reactiveResult = onSchedulerTick(cycleStartWallTime);
        if (reactiveResult.hungCycle?.action === 'terminate') {
          slog('REACTIVE', 'HUNG CYCLE TERMINATE — skipping Claude call');
          recordFailure('hung-cycle-terminated', `cycle duration ${reactiveResult.hungCycle.durationMs}ms`);
        }
        for (const zombie of reactiveResult.zombieProcesses.filter(z => z.reaped)) {
          recordFailure('zombie-reaped', `task ${zombie.taskId} reaped after excessive ticks`);
        }
      } catch { /* non-critical */ }

      // Inject triage intent hint into prompt (rule-based, zero LLM cost)
      const triageHint = `\n\nPre-triage recommendation: ${cycleIntent.mode} — ${cycleIntent.reason}${cycleIntent.focus ? ` (focus: ${cycleIntent.focus})` : ''}. This is a suggestion, not an order — override if your perception says otherwise.`;

      // ── Hesitation: inject held tags for review ──
      let hesitationReviewSuffix = '';
      if (isEnabled('hesitation-signal')) {
        const heldTags = drainHeldTags();
        if (heldTags.length > 0) {
          hesitationReviewSuffix = '\n\n' + buildHeldTagsPrompt(heldTags);
        }
      }

      // Phase 1d: Inject work journal context on first cycle after restart (one-shot)
      const workJournalSuffix = this.workJournalContext
        ? `\n\n${this.workJournalContext}`
        : '';
      if (this.workJournalContext) this.workJournalContext = null; // one-shot: 用完即清

      const promptResult = await buildAutonomousPromptFn({
        lastAutonomousActions: this.lastAutonomousActions,
        consecutiveLearnCycles: this.consecutiveLearnCycles,
        lastValidConfig: this.lastValidConfig,
        hasPendingTasks,
        cycleCount: this.cycleCount,
      });
      this.lastValidConfig = promptResult.lastValidConfig;

      // Noop recovery: when stuck in TRUE noop spiral (zero tags), inject directive.
      // Uses trueNoopStreak to avoid punishing cycles that produce internal work.
      let noopRecoverySuffix = '';
      if (this.trueNoopStreak >= 20) {
        noopRecoverySuffix = `\n\n⚠️ NOOP RECOVERY (trueNoop=${this.trueNoopStreak}): You have produced ZERO action tags for ${this.trueNoopStreak} consecutive cycles. You MUST produce at least one action this cycle:\n- <kuro:chat> to communicate what you've been working on or what's blocking you\n- <kuro:delegate> to delegate a concrete task\n- <kuro:done> to mark a completed task\nIf you genuinely have nothing to do, say so with <kuro:chat>. Do NOT continue silent cycles.`;
      }

      // DQ + noop combined trigger: when decision quality is low AND in noop spiral,
      // inject a specific actionable directive instead of generic "think better"
      if (this.trueNoopStreak >= 5 && this.trueNoopStreak < 20) {
        try {
          const { readState } = await import('./feedback-loops.js');
          const dqState = readState<{ avgScore: number; warningInjected: boolean }>('decision-quality.json', { avgScore: 6, warningInjected: false });
          if (dqState.warningInjected && dqState.avgScore < 2.0) {
            noopRecoverySuffix += `\n\n⚠️ DQ+NOOP: avgScore=${dqState.avgScore}/6 + ${this.trueNoopStreak} silent cycles. 不要分析問題 — 做一件具體的事：回覆一則訊息、完成一個任務、或用 <kuro:chat> 說明你的判斷。Doing > thinking.`;
          }
        } catch { /* non-critical */ }
      }

      const prompt = priorityPrefix + schedulerTaskPrefix + promptResult.prompt + triageHint + triggerSuffix + previousCycleSuffix + interruptedSuffix + foregroundReplySuffix + hesitationReviewSuffix + workJournalSuffix + noopRecoverySuffix;

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
      // Fix 3b: Force 'respond' mode when foreground delegations are pending (block reflect/learn)
      const hasPendingFgDelegations = getPendingForegroundDelegations().length > 0;
      // Fix 4: Force 'task' mode when pending tasks exist — prevents learn/reflect when there's real work to do
      const hasPendingTrackedTasks = !isDirectMessage && (nextPendingItems.length > 0 || p0Previews.length > 0);
      // Research Loop Gate: force 'act' mode when stuck in consecutive research-only cycles
      const researchLoopForceAct = promptResult.researchLoopActive;
      const cycleMode = hasPendingFgDelegations
        ? 'respond' as import('./memory.js').CycleMode
        : hasPendingTrackedTasks
          ? 'task' as import('./memory.js').CycleMode
          : researchLoopForceAct
            ? 'act' as import('./memory.js').CycleMode
            : (cycleIntent?.mode ?? detectCycleModeFn(context, currentTriggerReason, this.consecutiveLearnCycles, { hasPendingTasks, hasHighPriorityTasks, consecutiveIdleCycles: this.consecutiveIdleCycles }));

      // Idle mode: replace prompt entirely with a lightweight idle prompt to avoid noop spirals
      const effectivePrompt = cycleMode === 'idle' ? buildIdlePrompt() : prompt;

      // Intelligent model routing: decide Opus vs Sonnet based on cycle characteristics
      const modelRoute = routeModel({
        triggerReason: currentTriggerReason,
        cycleMode,
        hasDirectMessage: !!isDirectMessage,
        hasInbox: inboxItems.length > 0,
      });
      const modelCliName = getModelCliName(modelRoute.model);
      if (modelRoute.model === 'sonnet') {
        slog('MODEL', `→ Sonnet (${modelRoute.reason})`);
      }

      // Phase 2: Concurrent Action — run perception refresh + housekeeping during Claude await
      const concurrentPromise = isEnabled('concurrent-action')
        ? (() => {
            const done = trackStart('concurrent-action');
            return this.runConcurrentTasks()
              .then(inboxCount => { done(); return inboxCount; })
              .catch(e => { done(String(e)); return 0; });
          })()
        : Promise.resolve(0);

      // Streaming chat — fire <kuro:chat> tags as soon as they're detected during generation
      // Heart/Mouth architecture: DM cycles stream directly (speed matters for response).
      // Non-DM (proactive) cycles defer to Foreground expression (quality > speed).
      const isDmCycle = isTelegramUserCycle || isRoomPriorityCycle || isChatPriorityCycle;
      const streamedChatTexts = new Set<string>();
      const deferredChats: Array<{ text: string; reply: boolean }> = [];
      const onStreamChat = (text: string, reply: boolean) => {
        streamedChatTexts.add(text);
        if (isDmCycle) {
          const telegramMsgId = matchReplyTarget(text, this.triggerTelegramMsgs);
          eventBus.emit('action:chat', { text, reply, roomReplyTo: this.triggerRoomMsgId, telegramMsgId });
          slog('STREAM', `Chat streamed: ${text.slice(0, 80)}`);
        } else {
          deferredChats.push({ text, reply });
          slog('STREAM', `Chat deferred to expression: ${text.slice(0, 80)}`);
        }
      };

      // Concurrent tasks must not block the cycle — metabolism scans observed at 96min+.
      // Race with a 2min timeout; if concurrent tasks are slower, proceed without their results.
      const CONCURRENT_TIMEOUT_MS = 120_000;
      const concurrentWithTimeout = Promise.race([
        concurrentPromise,
        new Promise<number>(resolve => setTimeout(() => {
          slog('LOOP', `[concurrent] Timeout after ${CONCURRENT_TIMEOUT_MS / 1000}s — proceeding without results`);
          resolve(0);
        }, CONCURRENT_TIMEOUT_MS)),
      ]);

      const [claudeResult, newInboxCount] = await Promise.all([
        timed(
          `cycle#${this.cycleCount}.callClaude`,
          () => callClaude(effectivePrompt, context, 2, {
            rebuildContext: (mode, budget) => memory.buildContext({ mode, cycleCount: this.cycleCount, trigger: currentTriggerReason ?? undefined, contextBudget: budget }),
            source: 'loop',
            onPartialOutput,
            cycleMode,
            model: modelCliName,
            onStreamChat,
            triggerReason: currentTriggerReason,
          }),
          { alwaysLog: true },
        ),
        concurrentWithTimeout,
      ]);
      const callClaudeEndTs = performance.now();

      const { response, systemPrompt, fullPrompt, duration, preempted, error: errorClassification } = claudeResult;

      // Inbox urgency: new items arrived during Claude thinking → flag for fast scheduling
      if (newInboxCount > 0 && isEnabled('concurrent-action')) {
        this.concurrentInboxDetected = true;
        slog('LOOP', `[concurrent] ${newInboxCount} inbox items detected during Claude await — will schedule fast next`);
      }

      // Phase 1b: Handle preemption
      if (preempted) {
        this.interruptedCycleInfo = `Mode: ${this.currentMode}, Prompt: ${prompt.slice(0, 200)}`;
        slog('LOOP', `Cycle preempted — will resume next cycle`);
        eventBus.emit('action:loop', { event: 'cycle.preempted', cycleCount: this.cycleCount });
        // Don't clear checkpoint — leave it for crash recovery
        return null;
      }

      // Structured error tracking: propagate classification to feedback-loops
      if (errorClassification) {
        slog('LOOP', `Claude error: ${errorClassification.type} — ${errorClassification.modelGuidance.slice(0, 100)}`);
        eventBus.emit('trigger:sense', {
          type: 'claude-error',
          errorType: errorClassification.type,
          guidance: errorClassification.modelGuidance,
          retryable: errorClassification.retryable,
        }, { priority: 'P2', source: 'loop' });
      }

      // oMLX Gate R8: Store response in cache for future identical contexts
      if (!preempted && response) {
        cacheResponse(contextHash, response, currentTriggerReason ?? undefined);
      }

      // Busy recovery: Claude was held by another call (e.g. cron task).
      // For DM triggers, schedule retry instead of silently dropping Alex's message.
      if (duration === 0 && response.includes('正在處理另一個請求') && isDirectMessage) {
        if (this.busyRetryCount < 3) {
          this.busyRetryCount++;
          const delay = 3000 * this.busyRetryCount; // 3s, 6s, 9s backoff
          slog('LOOP', `Claude busy during ${currentTriggerReason} — retry ${this.busyRetryCount}/3 in ${delay / 1000}s`);
          this.triggerReason = currentTriggerReason;
          setTimeout(() => this.runCycle(), delay);
          return null;
        }
        slog('LOOP', `Claude busy during ${currentTriggerReason} — max retries, will catch via inbox recovery`);
        this.busyRetryCount = 0;
      } else {
        this.busyRetryCount = 0;
      }

      // A4: Empty response guard — log and skip tag processing
      if (!response || response.trim().length === 0) {
        slog('LOOP', `#${this.cycleCount} ⚠️ Claude returned empty response — skipping tag processing`);
        this.noopStreak++;
        this.trueNoopStreak++;
        if (this.noopStreak === 5) {
          notifyTelegram(`⚠️ noopStreak=${this.noopStreak} — 連續 ${this.noopStreak} cycle 無可見產出`).catch(() => {});
        }
        if (this.noopStreak === 10) {
          notifyTelegram(`🚨 noopStreak=${this.noopStreak} — 可能進入 noop spiral`).catch(() => {});
        }
        this.adjustInterval(false);
        eventBus.emit('action:loop', { event: 'idle', cycleCount: this.cycleCount, duration, nextHeartbeat: Math.round(this.currentInterval / 1000) });
        return null;
      }

      // 結構化記錄 Claude 呼叫
      logger.logClaudeCall(
        { userMessage: prompt, systemPrompt, context: `[${context.length} chars]`, fullPrompt },
        { content: response },
        { duration, success: true, mode: this.currentMode }
      );

      // ── Act ──
      const actionMatch = response.match(/<kuro:action>([\s\S]*?)<\/kuro:action>/);
      let action: string | null = null;

      // Load behavior config for cooldowns
      const { config: behaviorConfig, lastValidConfig: updatedConfig } = loadBehaviorConfigFn(this.lastValidConfig);
      this.lastValidConfig = updatedConfig;
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

        // Track consecutive idle cycles — reset on any real action
        this.consecutiveIdleCycles = 0;

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
        // Track consecutive idle cycles for escalation
        if (cycleMode === 'idle') {
          this.consecutiveIdleCycles++;
        } else {
          this.consecutiveIdleCycles = 0;
        }
      }

      logger.logCron('loop-cycle', action ? `[${this.currentMode}] ${action}` : 'No action', 'agent-loop', {
        duration,
        success: true,
      });
      const decision = action ? `${action.slice(0, 100)}` : `no action`;
      // CYCLE-TRACE: end-to-end cycle duration (every cycle, always logged).
      // Paired with individual [TIMING] cycle#N.phase0/buildContext/callClaude lines
      // and the postProcess span (callClaude-end → cycle-end), this gives the full
      // data pipeline for every cycle without running a profiler.
      const cycleTotalMs = Math.round(performance.now() - cycleStartTs);
      const postProcessMs = Math.round(performance.now() - callClaudeEndTs);
      slog(
        'CYCLE-TRACE',
        `#${this.cycleCount} total=${cycleTotalMs}ms postProcess=${postProcessMs}ms trigger=${(currentTriggerReason ?? '').slice(0, 30)} decision=${decision.slice(0, 40)}`,
      );
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

      // Soft falsifier gate — reuse shared extractDecisionBlock (fire-and-forget)
      try {
        const decision = extractDecisionBlock(response);
        if (decision?.chose) {
          writeCommitment({
            cycle_id: this.cycleCount,
            prediction: decision.chose,
            falsifier: decision.falsifier ?? null,
            ttl_cycles: decision.ttl ?? 5,
          });
          if (!decision.falsifier) slog('LEDGER', 'soft-gate: OODA action without falsifier');
        }
      } catch { /* fire-and-forget */ }

      // ── Filter out chats already sent via streaming ──
      // MUST run before hesitation: hesitation mutates chat.text (appends hedge),
      // which breaks the text-based dedup check against streamedChatTexts.
      // Uses normalized comparison as fallback: stream parser and batch parser may extract
      // subtly different text from the same source (e.g., different whitespace boundaries
      // when content spans multiple text blocks across tool-use turns).
      let didReplyToTelegram = false;
      if (streamedChatTexts.size > 0 && isDmCycle) {
        // DM cycles: filter out already-streamed chats (they were posted in real-time)
        const normalize = (t: string) => t.trim().replace(/\s+/g, ' ');
        const normalizedStreamed = new Set([...streamedChatTexts].map(normalize));
        const before = tags.chats.length;
        tags.chats = tags.chats.filter(c => {
          if (streamedChatTexts.has(c.text)) return false; // exact match
          if (normalizedStreamed.has(normalize(c.text))) return false; // normalized match
          return true;
        });
        if (before !== tags.chats.length) {
          slog('STREAM', `Filtered ${before - tags.chats.length} already-streamed chat(s)`);
          didReplyToTelegram = true; // streamed chats count as replied
        }
      } else if (streamedChatTexts.size > 0 && !isDmCycle) {
        // Proactive cycles: chats were deferred (not posted), mark as replied for tracking
        didReplyToTelegram = true;
      }

      // ── Hesitation Signal（確定性，零 API call）──
      let hesitationScheduleReview = false;
      if (isEnabled('hesitation-signal')) {
        const errorPatterns = loadErrorPatterns();
        const hesitationResult = hesitate(response, tags, errorPatterns);
        recordPatternHits(hesitationResult.matchedPatternIds);
        if (!hesitationResult.confident) {
          const { held, scheduleReview } = applyHesitation(tags, hesitationResult);
          hesitationScheduleReview = scheduleReview;
          if (held.length > 0) {
            saveHeldTags(held);
            slog('HESITATION', `Score ${hesitationResult.score}: held ${held.map(h => h.type).join(', ')}`);
          }
          logHesitation(hesitationResult, held.length > 0 ? `held:${held.map(h => h.type).join(',')}` : 'marked', this.cycleCount);
        }
      }

      // ── Side Effect Tracking (Layer 4 Enhanced Checkpoint) ──
      const cycleSideEffects: string[] = [];
      const cycleTagsProcessed: string[] = [];

      for (const rem of tags.remembers) {
        if (rem.topic) {
          await memory.appendTopicMemory(rem.topic, rem.content, rem.ref);
        } else {
          await memory.appendMemory(rem.content);
        }
        // Learning→Perception classifier: categorize + log actionable items
        const category = classifyRemember(rem.content, rem.topic);
        eventBus.emit('action:memory', { content: rem.content, topic: rem.topic, category });
        if (ACTIONABLE_CATEGORIES.has(category)) {
          logPendingImprovement({
            category,
            content: rem.content,
            topic: rem.topic,
            timestamp: new Date().toISOString(),
          }).catch(() => {}); // fire-and-forget
        }
        slog('CLASSIFY', `[${category}] ${rem.content.slice(0, 80)}...`);
        cycleSideEffects.push(`remember:${rem.topic ?? 'MEMORY.md'}`);
        cycleTagsProcessed.push('REMEMBER');
      }

      for (const t of tags.tasks) {
        await memory.addTask(t.content, t.schedule);
        eventBus.emit('action:task', { content: t.content });
        cycleSideEffects.push(`task:${t.content.slice(0, 60)}`);
        cycleTagsProcessed.push('TASK');
      }

      // <kuro:impulse> tags — persist creative impulses
      for (const impulse of tags.impulses) {
        memory.addImpulse(impulse).catch(() => {}); // fire-and-forget
      }

      // <kuro:inner> tag — working memory (cross-cycle scratch pad)
      if (tags.inner) {
        const mode = getMode();
        if (mode.mode === 'reserved' || mode.mode === 'autonomous') {
          const innerPath = path.join(memory.getMemoryDir(), 'inner-notes.md');
          const tmpPath = innerPath + '.tmp';
          fs.writeFileSync(tmpPath, tags.inner, 'utf-8');
          fs.renameSync(tmpPath, innerPath);
          slog('INNER', `Working memory updated (${mode.mode})`);
        }
      } else {
        // Cascade Task B: 9B auto-generates working memory when Claude didn't write <kuro:inner>
        const mode = getMode();
        if (mode.mode === 'reserved' || mode.mode === 'autonomous') {
          try {
            generateWorkingMemory(memory.getMemoryDir(), action ?? '', cycleTagsProcessed);
          } catch { /* fail-open: keep existing inner-notes */ }
        }
      }

      // ── Record side effects for streamed chats ──
      if (streamedChatTexts.size > 0) {
        for (const text of streamedChatTexts) {
          cycleSideEffects.push(`chat:${text.slice(0, 60)}`);
          cycleTagsProcessed.push('CHAT');
        }
      }

      // ── Telegram Reply（OODA-Only：telegram-user 觸發時自動回覆 Alex） ──
      // Uses unified sendChat() gateway for dedup
      if (currentTriggerReason?.startsWith('telegram-user') && tags.chats.length > 0) {
        const replyContent = tags.chats.map(c => c.text).join('\n\n');
        if (replyContent) {
          didReplyToTelegram = true;
          const replyTarget = matchReplyTarget(replyContent, this.triggerTelegramMsgs);
          sendChat(replyContent, {
            reply: true,
            telegramMsgId: replyTarget ?? undefined,
            roomReplyTo: this.triggerRoomMsgId ?? undefined,
            directReply: true,
          });
          cycleSideEffects.push(`chat:${replyContent.slice(0, 60)}`);
          cycleTagsProcessed.push('CHAT');
          // Clear chats — already sent via OODA reply, skip action:chat to prevent duplicate
          tags.chats.length = 0;
        }
      }

      for (const chat of tags.chats) {
        if (isDmCycle) {
          // DM: skip already-streamed, post directly
          if (streamedChatTexts.has(chat.text)) continue;
          eventBus.emit('action:chat', { text: chat.text, reply: chat.reply, roomReplyTo: this.triggerRoomMsgId, telegramMsgId: matchReplyTarget(chat.text, this.triggerTelegramMsgs) });
        } else {
          // Proactive: route through Foreground (heart → mouth → Alex)
          this.expressViaForeground(chat.text).catch(() => {});
        }
        cycleSideEffects.push(`chat:${chat.text.slice(0, 60)}`);
        cycleTagsProcessed.push('CHAT');
      }

      // Non-telegram-triggered cycles that sent <kuro:chat> also count as replied
      if (!didReplyToTelegram && tags.chats.length > 0) {
        didReplyToTelegram = true;
      }

      // ── Process <kuro:ask> tags — blocking questions that need Alex's reply ──
      for (const askText of tags.asks) {
        const askMsg = `❓ ${askText}`;
        cycleSideEffects.push(`ask:${askText.slice(0, 60)}`);
        cycleTagsProcessed.push('ASK');
        const askReplyTarget = matchReplyTarget(askText, this.triggerTelegramMsgs);
        notifyTelegram(askMsg, askReplyTarget ?? undefined).catch((err) => {
          slog('LOOP', `Telegram ask failed: ${err instanceof Error ? err.message : err}`);
        });
        // Create a conversation thread so it persists until Alex replies
        memory.addConversationThread({
          type: 'question',
          content: askText.slice(0, 200),
          source: 'kuro:ask',
        }).catch(() => {});
        eventBus.emit('action:chat', { text: askText, blocking: true, roomReplyTo: this.triggerRoomMsgId, telegramMsgId: askReplyTarget });
      }

      for (const show of tags.shows) {
        eventBus.emit('action:show', { desc: show.desc, url: show.url });
      }

      for (const summary of tags.summaries) {
        eventBus.emit('action:summary', { text: summary });
      }

      // ── Process <kuro:thread> tags ──
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

      // ── Process <kuro:delegate> tags — spawn async background tasks ──
      for (const del of tags.delegates) {
        const taskId = spawnDelegation({
          prompt: del.prompt,
          workdir: del.workdir,
          type: del.type,
          provider: del.provider,
          maxTurns: del.maxTurns,
          verify: del.verify,
          acceptance: del.acceptance,
        });
        const taskType = del.type ?? 'code';
        const resolvedProvider = del.provider ?? (taskType === 'shell' ? 'shell' : (['learn', 'research'].includes(taskType) ? 'local' : 'claude'));
        slog('DISPATCH', `Delegation spawned: ${taskId} (type=${taskType}, provider=${resolvedProvider}) → ${del.workdir}`);
        eventBus.emit('action:delegation-start', { taskId, type: taskType, workdir: del.workdir });
        try { kbObserve({ source: 'delegation', type: 'spawn', data: { taskId, taskType, workdir: del.workdir }, tags: [taskType] }); } catch { /* fire-and-forget */ }
        cycleSideEffects.push(`delegate:${taskType}:${del.workdir}`);
        cycleTagsProcessed.push('DELEGATE');
        // Auto-register delegate as task in memory-index for Activity Monitor visibility
        try {
          const { appendMemoryIndexEntry } = await import('./memory-index.js');
          const memDir = path.join(process.cwd(), 'memory');
          await appendMemoryIndexEntry(memDir, {
            id: taskId,
            type: 'task',
            status: 'in_progress',
            source: 'ooda-delegate',
            summary: `[delegate:${taskType}] ${del.prompt.slice(0, 80)}`,
          });
          registerProcess({ id: taskId, summary: `[delegate:${taskType}] ${del.prompt.slice(0, 60)}`, priority: 2, source: 'kuro' as const, status: 'in_progress', createdAt: new Date().toISOString(), ticksSpent: 0, deadline: null, dependsOn: [] });
        } catch { /* fire-and-forget */ }
      }

      // ── Process <kuro:done> tags — mark tasks completed in memory-index ──
      if (tags.dones.length > 0) {
        // Guard: reply tasks require actual reply (<kuro:chat>) to be marked done.
        // Without this, Kuro can mark "回覆 alex" tasks done without sending a reply.
        const hasReply = tags.chats.length > 0;
        const filteredDones = tags.dones.filter(d => {
          const isReplyTask = /回覆|reply/i.test(d);
          if (isReplyTask && !hasReply) {
            slog('DONE', `⛔ Blocked: "${d.slice(0, 60)}" — reply task requires <kuro:chat>`);
            return false;
          }
          return true;
        });
        if (filteredDones.length > 0) {
          markTaskDoneByDescription(path.join(process.cwd(), 'memory'), filteredDones).catch(() => {});
          for (const done of filteredDones) {
            markTaskProgressDone(done);
          }
          // Agent OS: notify scheduler + process table of task completion
          const schedState = getSchedulerState();
          if (schedState.currentTaskId) {
            schedulerTaskDone(schedState.currentTaskId);
            completeProcess(schedState.currentTaskId);
          }
          try {
            const { recordSuccessPattern } = await import('./success-patterns.js');
            for (const done of filteredDones) {
              recordSuccessPattern(done, action ?? '', [...cycleTagsProcessed], this.currentMode);
            }
          } catch { /* fire-and-forget */ }
        }
      }

      // ── Process <kuro:progress> tags — task progress tracking ──
      trackTaskProgress(tags);

      // Auto-detect lastAction from objective signals when <kuro:action> is absent
      // Fixes: observability shouldn't depend on LLM remembering to write a tag
      if (!action && cycleTagsProcessed.length > 0) {
        const autoAction = `[Auto] ${cycleTagsProcessed.join(', ')}`;
        this.lastAction = autoAction;
        action = autoAction;
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

      // noop streak bookkeeping — two separate streaks:
      // 1. noopStreak: no VISIBLE output (CHAT/ASK/SHOW/DELEGATE) — for notifications only
      // 2. trueNoopStreak: ZERO tags processed — for punitive guards (P0 block, backoff, recovery)
      // This prevents throttling cycles that do internal work (TASK/REMEMBER/ACTION).
      //
      // Foreground lane actions count: replies drained at cycle start OR pushed during cycle.
      // Not counting these caused noop spiral (Dual-Fault Death Spiral).
      const hadForegroundAction = this.hadForegroundActionThisCycle || this.foregroundReplyRecords.length > 0;
      // Main loop visible output — only from main OODA cycle tags
      const hasMainVisibleOutput = cycleTagsProcessed.some(t =>
        t === 'CHAT' || t === 'ASK' || t === 'SHOW' || t === 'DELEGATE'
      );
      const hasAnyAction = hadForegroundAction || cycleTagsProcessed.length > 0;

      // Snapshot before reset — used by adjustInterval for momentum reward
      this.prevTrueNoopStreak = this.trueNoopStreak;

      // Akari review: noopStreak = main loop health, trueNoopStreak = agent-level activity.
      // Foreground action resets trueNoopStreak (agent is doing work) but NOT noopStreak
      // (main loop still needs to produce its own output to be considered healthy).
      if (hasMainVisibleOutput) {
        this.noopStreak = 0;
        this.trueNoopStreak = 0;
      } else if (hadForegroundAction) {
        slog('LOOP', `#${this.cycleCount} Foreground action counted — trueNoop reset, noopStreak=${this.noopStreak} preserved`);
        this.trueNoopStreak = 0;
        // noopStreak preserved — main loop health signal stays accurate
        // But dampen it to prevent spiral: halve if getting high
        if (this.noopStreak > 8) {
          this.noopStreak = Math.ceil(this.noopStreak / 2);
        }
      } else {
        this.noopStreak++;
        if (cycleTagsProcessed.length > 0) {
          this.trueNoopStreak = 0;
        } else {
          this.trueNoopStreak++;
        }
      }

      if (this.noopStreak >= 3 && !hasMainVisibleOutput) {
        slog('LOOP', `#${this.cycleCount} 🪫 noop streak=${this.noopStreak} (trueNoop=${this.trueNoopStreak})`);
      }
      if (this.noopStreak >= 3 && action) {
        const summary = action.length > 300 ? action.slice(0, 300) + '…' : action;
        notifyTelegram(`🔄 #${this.cycleCount} (silent×${this.noopStreak}): ${summary}`).catch(() => {});
      }
      if (this.noopStreak === 5 && !action) {
        notifyTelegram(`⚠️ noopStreak=${this.noopStreak} — 連續 ${this.noopStreak} cycle 無可見產出`).catch(() => {});
      }
      if (this.noopStreak === 10) {
        notifyTelegram(`🚨 noopStreak=${this.noopStreak} — 可能進入 noop spiral`).catch(() => {});
      }

      // Persist both streaks across restarts
      saveLoopHealth({
        noopStreak: this.noopStreak,
        trueNoopStreak: this.trueNoopStreak,
        lastVisibleOutputAt: (hasMainVisibleOutput || hadForegroundAction) ? new Date().toISOString() : null,
        updatedAt: new Date().toISOString(),
      });

      // A3: Auto-clear poisoned lastAutonomousActions
      const NO_ACTION_RE = /^no action|minimal-retry streak/i;
      const allNoop = this.lastAutonomousActions.length > 0
        && this.lastAutonomousActions.every(a => NO_ACTION_RE.test(a.trim()));
      if (allNoop) {
        slog('LOOP', `Clearing ${this.lastAutonomousActions.length} poisoned lastAutonomousActions`);
        this.lastAutonomousActions = [];
      }

      // <kuro:schedule> tag — Kuro 自主排程覆蓋
      this.lastCycleHadSchedule = !!tags.schedule;
      if (tags.schedule) {
        // Guard: tags.schedule.next may be undefined when LLM emits <kuro:schedule>
        // with only nested fields (e.g. <reason>) and no <next>. Without this guard
        // .trim() throws "Cannot read properties of undefined" — see recurring error
        // "Cannot read properties of unde:generic::loop.runCycle" (72× through 2026-04-25).
        const nextRaw = tags.schedule.next?.trim().toLowerCase() ?? '';
        const isNow = nextRaw === 'now';
        if (isNow) {
          this.consecutiveNowCount++;
        } else {
          this.consecutiveNowCount = 0;
        }

        // Safety: cap consecutive "now" to prevent infinite loop
        if (isNow && this.consecutiveNowCount > AgentLoop.MAX_CONSECUTIVE_NOW) {
          this.currentInterval = this.config.intervalMs; // reset to base
          this.consecutiveNowCount = 0;
          eventBus.emit('action:loop', {
            event: 'schedule',
            next: 'now (capped)',
            reason: `consecutive now limit (${AgentLoop.MAX_CONSECUTIVE_NOW}) reached, reset to base interval`,
            bounded: true,
          });
        } else {
          const ms = parseScheduleInterval(tags.schedule.next);
          if (ms > 0) {
            // Schedule Ceiling: 2h max (Ulysses contract — 消除逃避空間)
            const bounded = Math.max(30_000, Math.min(7_200_000, ms));
            this.currentInterval = bounded;
            eventBus.emit('action:loop', {
              event: 'schedule',
              next: tags.schedule.next,
              reason: tags.schedule.reason,
              bounded: bounded !== ms,
            });
          }
        }
      } else {
        this.consecutiveNowCount = 0;
      }

      // ── Hesitation: schedule short review cycle if tags were held ──
      if (hesitationScheduleReview && !tags.schedule) {
        // Override interval to 2min for held tag review (same bounds as <kuro:schedule>)
        this.currentInterval = 120_000; // 2 minutes
        eventBus.emit('action:loop', {
          event: 'schedule',
          next: '2m',
          reason: 'hesitation review: held tags pending',
          bounded: false,
        });
      }

      // Phase 1c: Save final checkpoint with side effects, then clear on success
      if (cycleSideEffects.length > 0) {
        saveCycleCheckpoint({
          startedAt: new Date().toISOString(),
          mode: this.currentMode,
          triggerReason: currentTriggerReason,
          promptSnippet: prompt.slice(0, 500),
          partialOutput: response.slice(0, 500),
          lastAction: this.lastAction,
          lastAutonomousActions: this.lastAutonomousActions.slice(-10),
          sideEffects: cycleSideEffects,
          tagsProcessed: cycleTagsProcessed,
          pendingPriorityInfo: this.pendingPriority ? `${this.pendingPriority.reason}:${this.pendingPriority.messageCount}msg` : null,
        });
      }
      clearCycleCheckpoint();

      // ── Record Stimulus Fingerprint (fire-and-forget, cross-cycle dedup) ──
      {
        const loadedTopics = memory.getLoadedTopics();
        const fingerprint = buildStimulusFingerprint(currentTriggerReason, loadedTopics);
        writeStimulusFingerprint({
          ts: new Date().toISOString(),
          fingerprint,
          trigger: currentTriggerReason,
          action: action || null,
          topics: loadedTopics,
        });
      }

      // ── Write Work Journal (fire-and-forget, survives restart) ──
      writeWorkJournal({
        ts: new Date().toISOString(),
        cycle: this.cycleCount,
        action: action || 'no-action',
        trigger: currentTriggerReason,
        tags: cycleTagsProcessed,
        sideEffects: cycleSideEffects,
      });

      // ── Emit Activity Stream (side-effect cycles only, for Activity Monitor) ──
      emitActivity({
        cycle: this.cycleCount,
        action,
        tags: cycleTagsProcessed,
        sideEffects: cycleSideEffects,
        trigger: currentTriggerReason,
        lane: 'ooda',
      });

      // ── Save Reasoning Snapshot (fire-and-forget, cross-cycle continuity) ──
      {
        const decisionText = extractDecisionSection(response);
        const innerNotesText = extractInnerNotes(response);
        const rememberTopics = tags.remembers.filter(r => r.topic).map(r => r.topic!);
        if (decisionText || innerNotesText) {
          saveReasoningSnapshot({
            ts: new Date().toISOString(),
            cycle: this.cycleCount,
            trigger: currentTriggerReason,
            decision: decisionText,
            innerNotes: innerNotesText,
            keyInsights: rememberTopics,
          });
        }
      }

      // ── Write Activity Journal (fire-and-forget, cross-lane awareness) ──
      // Skip no-action cycles — they're noise in the activity timeline
      if (action) {
        // Extract clean summary: "chose:" line if present, else first meaningful line
        const actSummary = (() => {
          const choseMatch = action.match(/chose:\s*(.+)/);
          if (choseMatch) return choseMatch[1].trim();
          const firstLine = action.split('\n').find(l => l.trim() && !l.startsWith('#'));
          return firstLine?.trim() || action.split('\n')[0].trim();
        })();
        writeActivity({
          lane: 'ooda',
          summary: actSummary,
          trigger: currentTriggerReason ?? undefined,
          tags: cycleTagsProcessed.length > 0 ? cycleTagsProcessed : undefined,
          duration,
        });
      }

      // ── Update Temporal State (fire-and-forget) ──
      const topicList = tags.remembers.filter(r => r.topic).map(r => r.topic!);
      const touchedTopics = topicList.length > 0 ? topicList : undefined;
      updateTemporalState({
        mode: this.currentMode,
        action,
        topics: touchedTopics,
      }).then(() => flushTemporalState()).catch(() => { flushTemporalState(); });

      // ── Write Trail Entry (fire-and-forget, shared attention history) ──
      {
        const trailTopics = extractTrailTopics(currentTriggerReason, topicList, cycleSideEffects, action);
        const detailParts: string[] = [];
        if (currentTriggerReason) detailParts.push(`trigger: ${currentTriggerReason}`);
        if (action) detailParts.push(`decision: ${action.slice(0, 200)}`);
        if (cycleTagsProcessed.length > 0) detailParts.push(`tags: ${cycleTagsProcessed.join(',')}`);
        writeTrailEntry({
          ts: new Date().toISOString(),
          agent: 'kuro',
          type: 'focus',
          topics: trailTopics,
          detail: detailParts.join('; '),
          decay_h: 24,
        });
      }

      // ── Fail-closed: OODA lane only speaks through explicit <kuro:chat> tags ──
      // Previously: fallback posted cleanContent to Room/TG when no <kuro:chat> was found.
      // This was fail-open — internal reasoning leaked to Room (ping messages, Decision format).
      // Now: no <kuro:chat> = no external output. Internal content goes to behavior log only.
      if (currentTriggerReason?.startsWith('telegram-user') && !didReplyToTelegram) {
        const fallbackContent = tags.cleanContent.replace(/<kuro:action>[\s\S]*?<\/kuro:action>/g, '').trim();
        if (fallbackContent && fallbackContent.length > 20) {
          slog('LOOP', `[fail-closed] OODA cycle had no <kuro:chat> — suppressed: ${fallbackContent.slice(0, 120)}`);
        }
      }

      // Compute DM cycle sources up-front (used by safety net + inbox marking).
      // Naming note: didReplyToTelegram is misleading — by the time we reach here it
      // tracks "any <kuro:chat> was emitted", not telegram-specific (see line 2271).
      const cycleSources = new Set<string>();
      if (currentTriggerReason?.startsWith('telegram-user')) cycleSources.add('telegram');
      if (currentTriggerReason?.startsWith('room')) cycleSources.add('room');
      if (currentTriggerReason?.startsWith('chat')) cycleSources.add('chat');
      const isDirectMessageCycle = cycleSources.size > 0;

      // ── DM no-reply safety net (symmetric across all DM sources) ──
      // If a DM cycle (telegram OR room OR chat) finished without ANY visible <kuro:chat>,
      // leave items from that source pending so inbox recovery retries on a later cycle.
      // Previously this only protected 'telegram' — room/chat items got false-marked 'seen'
      // when Kuro responded with malformed tags (e.g. self-invented <reply_plan>) or with
      // only <kuro:inner> monologue. Same prescription→convergence bug as foreground lane.
      const dmNoReply = isDirectMessageCycle && !didReplyToTelegram;
      if (dmNoReply) {
        const sourcesStr = [...cycleSources].join('+');
        slog('LOOP', `⚠️ ${sourcesStr} cycle #${this.cycleCount} produced no visible reply — items stay pending for retry`);
      }

      // Clear 👀 reaction after reply — Alex 不需要看到「已讀」在回覆後仍停留
      if (currentTriggerReason?.startsWith('telegram-user') && didReplyToTelegram) {
        clearLastReaction();
      }

      // Fail-closed: no <kuro:chat> = no Room output. Unaddressed messages stay pending for retry.
      // Previously: mirrored <kuro:action> to Room as safety net — but this leaked internal content.
      if (action && tags.chats.length === 0 && !didReplyToTelegram) {
        slog('LOOP', `[fail-closed] Action without <kuro:chat> — not mirrored to Room. Items stay pending.`);
      }

      // 檢查 approved proposals → 自動建立 handoff
      if (isEnabled('approved-proposals')) await checkApprovedProposals();

      // Mark legacy inboxes as processed（cycle saw them all）
      markClaudeCodeInboxProcessed();
      markChatRoomInboxProcessed(response, tags, action);

      // Mark unified inbox items as processed (batch — single disk write).
      // Principle: each cycle marks items from its own trigger source as replied/seen.
      // Cross-source items (e.g. telegram items in a room-triggered cycle) are left pending
      // so their dedicated cycle can process them with appropriate priority prefix.
      // ACK-only reply guard: short acknowledgments (< 80 chars matching ACK patterns)
      // are promises of future follow-up, not actual answers. Don't count as "replied".
      // Mirrors the guard in inbox-processor.ts:274 that protects legacy inbox.
      // Without this, "讓我用瀏覽器看看" marks the item as replied and Kuro forgets to follow through.
      const ACK_REPLY_RE = /看到|收到|了解|好的|等下|馬上|稍後|讓我|先去|我來|我去|正在看|開始看|研究一下|仔細看/;
      const allCycleChats = [...streamedChatTexts, ...tags.chats.map(c => c.text)];
      const isAckOnlyReply = didReplyToTelegram
        && allCycleChats.length > 0
        && allCycleChats.every(t => t.length < 80 && ACK_REPLY_RE.test(t));
      if (isAckOnlyReply) {
        slog('LOOP', `⚠️ Cycle #${this.cycleCount} reply was ACK-only — inbox items stay pending for follow-through`);
      }
      const didReply = didReplyToTelegram && !isAckOnlyReply;

      for (const item of readPendingInbox()) {
        if (isDirectMessageCycle) {
          // DM cycle: only mark items from the triggering source
          if (cycleSources.has(item.source)) {
            // Convergence guard: if cycle produced no visible reply for this DM source,
            // leave the item pending so a later cycle can attempt a real reply.
            if (dmNoReply && cycleSources.has(item.source)) continue;
            queueInboxMark(item.id, didReply ? 'replied' : 'seen');
          }
          // Leave other sources' items untouched
        } else {
          // Non-DM cycle (heartbeat/workspace/cron): mark all non-DM items as seen,
          // and DM items that got a reply as replied
          if (!AgentLoop.DIRECT_MESSAGE_SOURCES.has(item.source)) {
            queueInboxMark(item.id, 'seen');
          } else if (didReply) {
            // DM item got a reply during a non-DM cycle (e.g. room reminder in heartbeat)
            queueInboxMark(item.id, 'replied');
          }
        }
      }
      flushInboxMarks(); // 單次磁碟寫入

      // Escalate overdue HEARTBEAT tasks（fire-and-forget）
      if (isEnabled('auto-escalate')) {
        const done = trackStart('auto-escalate');
        autoEscalateOverdueTasks().then(() => done(), e => done(String(e)));
      }

      // A2: HEARTBEAT size guard（fire-and-forget）
      guardHeartbeatSize();

      // Auto-commit → then auto-push（sequential，防止 push 在 commit 完成前觸發 CI/CD reset）
      // When concurrent-action is enabled, commit+push already ran during callClaude await.
      // This fallback handles current cycle's changes (from parseTags) — committed next cycle's concurrent phase.
      if (isEnabled('auto-commit') && !isEnabled('concurrent-action')) {
        const done = trackStart('auto-commit');
        autoCommitMemoryFiles(action)
          .then(() => {
            try { memory.updateConversationSearchIndex(); } catch { /* best effort */ }
          })
          .then(() => autoCommitExternalRepos())
          .then(() => {
            done();
            if (isEnabled('auto-push')) {
              const pushDone = trackStart('auto-push');
              return autoPushIfAhead().then(() => pushDone(), e => pushDone(String(e)));
            }
          })
          .catch(e => done(String(e)));
      }

      // GitHub mechanical automation（fire-and-forget）
      if (isEnabled('github-automation')) {
        const done = trackStart('github-automation');
        githubAutoActions().then(() => done(), e => done(String(e)));
      }

      // Intelligent feedback loops（fire-and-forget）+ deferred flush
      if (isEnabled('feedback-loops')) {
        const done = trackStart('feedback-loops');
        runFeedbackLoops(action, currentTriggerReason, context, this.cycleCount, modelRoute.model, response)
          .then(() => { flushFeedbackState(); done(); }, e => { flushFeedbackState(); done(String(e)); });
      }

      // Model outcome tracking（fire-and-forget）
      try {
        recordModelOutcome({
          model: modelRoute.model,
          cycleMode,
          triggerReason: currentTriggerReason ?? 'unknown',
          observabilityScore: 0, // populated by feedback-loops if available
          durationMs: duration,
          timestamp: new Date().toISOString(),
        });
      } catch { /* best effort */ }

      // Unified Pulse System — deterministic heuristics + optional 9B（fire-and-forget, every cycle）
      {
        const done = trackStart('pulse');
        runPulseCheck(action, this.cycleCount, response).then(() => done(), e => done(String(e)));
      }

      // Daily topic pruning — Haiku analysis（fire-and-forget, once per day）
      runDailyPruning(getMemory().getMemoryDir()).catch(() => {});

      // Commitment Binding — 追蹤承諾兌現（fire-and-forget）
      if (isEnabled('commitment-binding')) {
        try {
          extractCommitments(response, this.cycleCount);
          updateCommitments(action, this.cycleCount);
        } catch { /* best effort */ }
      }

      // Resolve stale ConversationThreads（replied 1h auto-resolve + 24h TTL + inbox-clear）
      if (isEnabled('stale-threads')) {
        const done = trackStart('stale-threads');
        resolveStaleConversationThreads(response).then(() => done(), e => done(String(e)));
      }

      // Housekeeping pipeline（fire-and-forget）
      if (isEnabled('housekeeping')) {
        const done = trackStart('housekeeping');
        runHousekeeping().then(() => done(), e => done(String(e)));

        // Topic summarization — update summaries for large topics (every 10 cycles, fire-and-forget)
        if (this.cycleCount % 10 === 0) {
          import('./memory-summarizer.js').then(({ runSummarizationCycle }) =>
            runSummarizationCycle(memory.getMemoryDir())
          ).catch(() => {});
        }
      }

      // Myelin distillation — periodic crystallization of triage + learning patterns (fire-and-forget)
      try {
        import('./myelin-fleet.js').then(({ maybeDistill }) => maybeDistill()).catch(() => {});
      } catch { /* fire-and-forget */ }

      // Delegation cleanup — remove completed tasks >24h（fire-and-forget）
      try { cleanupDelegations(); } catch { /* fire-and-forget */ }

      // Route tracking — record full cycle path for slime mold optimization (fire-and-forget)
      try {
        const route = buildCycleRoute(
          currentTriggerReason ?? 'unknown',
          modelRoute.model,
          context,
          action,
          isVisibleOutput(action),
          duration,
        );
        recordCycleRoute(route);
      } catch { /* fire-and-forget */ }

      // KB: observe OODA cycle outcome (fire-and-forget)
      try {
        kbObserve({
          source: 'ooda', type: 'outcome',
          data: { cycleCount: this.cycleCount, trigger: currentTriggerReason, model: modelRoute.model, tagsProcessed: cycleTagsProcessed },
          outcome: 'success',
          durationMs: duration,
          tags: cycleTagsProcessed,
        });
      } catch { /* fire-and-forget */ }

      // L4 ExpeL episode recording removed — consolidated into myelin-fleet.ts

      // Nutrient tracking — measure delegation result absorption (fire-and-forget)
      try { trackNutrientSignals(action, response); } catch { /* fire-and-forget */ }

      // Nutrient router — detect domain citations in response (slime mold feedback, fire-and-forget)
      try {
        const webResult = perceptionStreams.getCachedResults().find(r => r.name === 'web');
        if (webResult?.output) {
          const domainMatches = webResult.output.matchAll(/\[([^\]]+)\]/g);
          const contextDomains = [...domainMatches].map(m => m[1].replace(/ \(cached.*$/, '').trim()).filter(d => d.includes('.'));
          if (contextDomains.length > 0) {
            detectCitations(response, contextDomains);
          }
        }
      } catch { /* fire-and-forget */ }

      // Unified cycle nutrient tracking — slime mold efficiency metrics (fire-and-forget)
      try {
        const outputTags: string[] = [];
        if (tags.chats.length > 0) outputTags.push('chat');
        if (tags.shows.length > 0) outputTags.push('show');
        if (tags.dones.length > 0) outputTags.push('done');
        if (tags.summaries.length > 0) outputTags.push('summary');
        if (tags.remembers.length > 0) outputTags.push('remember');
        if (tags.delegates.length > 0) outputTags.push('delegate');
        if (tags.archive) outputTags.push('archive');
        if (tags.impulses.length > 0) outputTags.push('impulse');
        if (tags.tasks.length > 0) outputTags.push('task');
        if (tags.asks.length > 0) outputTags.push('ask');
        recordCycleNutrient({
          trigger: currentTriggerReason ?? 'unknown',
          context,
          action,
          response,
          outputTags,
          delegationsSpawned: tags.delegates.length,
          durationMs: duration,
        });
      } catch { /* fire-and-forget */ }

      // Lane-output cleanup — only stale >24h as safety net（fire-and-forget）
      // Active lane-output files are cleaned inline by buildBackgroundCompletedSection
      // after being read into context — prevents deletion before absorption
      try {
        const instanceId = getCurrentInstanceId();
        cleanupStaleLaneOutput(instanceId);
      } catch { /* fire-and-forget */ }

      // Drain one queued cron task（loopBusy now free）
      if (isEnabled('cron-drain')) {
        const done = trackStart('cron-drain');
        drainCronQueue().then(() => done(), e => done(String(e)));
      }

      // ── Constraint Texture: task staleness pressure ──
      incrementTaskStaleness(path.join(process.cwd(), 'memory')).then(staleTasks => {
        if (staleTasks.length === 0) return;
        this.staleTasks = staleTasks;

        // Escalation: >5 ticks → auto P0
        for (const t of staleTasks) {
          if (t.ticks > 5) {
            updateTask(path.join(process.cwd(), 'memory'), t.id, { priority: 0 }).catch(() => {});
            slog('CONSTRAINT', `Escalated to P0: ${t.summary.slice(0, 60)} (${t.ticks} ticks stale)`);
          }
        }

        // Escalation: >8 ticks → notify Alex
        const critical = staleTasks.filter(t => t.ticks > 8);
        if (critical.length > 0) {
          const msg = critical.map(t => `${t.summary.slice(0, 50)} (${t.ticks} ticks)`).join(', ');
          fetch('http://localhost:3001/api/room', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: 'system', text: `⚠️ @alex Stale tasks (${critical.length}): ${msg}` }),
          }).catch(() => {});
        }
      }).catch(() => {});

      return action;
    } finally {
      this.cycling = false;
      this.triggerRoomMsgId = null;
      this.triggerTelegramMsgs = [];

      // Cooperative yield: drain pending priority first
      if (this.pendingPriority) {
        const pp = this.pendingPriority;
        this.pendingPriority = null;
        this.directMessageWakeQueue = 0;
        this.lastPriorityDrainAt = Date.now();
        const waited = Math.round((Date.now() - pp.arrivedAt) / 1000);
        slog('LOOP', `Draining priority: ${pp.reason} (${pp.messageCount} msg, waited ${waited}s)`);
        eventBus.emit('action:loop', { event: 'priority.drain', reason: pp.reason, waitedMs: Date.now() - pp.arrivedAt });
        // Wait for concurrent callClaude (e.g. drainCronQueue) to finish before
        // starting priority cycle — otherwise busy guard blocks it (0.0s cycle)
        const drainStartWait = Date.now();
        const maxBusyWait = 120_000;
        const tryDrainPriority = () => {
          if (!this.running) {
            // Process shutting down — persist to WAL for next startup
            savePendingState(pp, this.directMessageWakeQueue);
            return;
          }
          // Pending priority came from P0/P1 direct messages — re-arm calm wake for drain
          if (this.paused) this.calmWake = true;
          if (isLoopBusy() && Date.now() - drainStartWait < maxBusyWait) {
            setTimeout(tryDrainPriority, 500);
            return;
          }
          if (!this.cycling) {
            const totalWaited = Math.round((Date.now() - pp.arrivedAt) / 1000);
            // Use the original source from pendingPriority reason (e.g. "telegram-P0", "room-P1")
            const drainSource = pp.reason.startsWith('telegram') ? 'telegram-user' : pp.reason.split('-')[0];
            this.triggerReason = `${drainSource} (yielded, waited ${totalWaited}s)`;
            this.runCycle();
          }
        };
        setTimeout(tryDrainPriority, 500);
      } else if (this.directMessageWakeQueue > 0) {
        // Drain queued direct message wake requests (telegram, room, chat)
        this.directMessageWakeQueue = 0;
        setTimeout(() => {
          // Direct message wakes — re-arm calm wake
          if (this.paused) this.calmWake = true;
          if (this.running && !this.cycling) {
            this.triggerReason = 'direct-message (queued)';
            this.runCycle();
          }
        }, 3000);
      }

      // Drain pending delegation results — trigger immediate cycle to absorb
      // This fires when a delegation completed while we were cycling.
      // Uses 'delegation-complete' reason which bypasses triage (hard rule).
      if (this.hasPendingDelegationResults && !this.pendingPriority) {
        this.hasPendingDelegationResults = false;
        slog('LOOP', '[delegation-complete] Draining pending results after cycle');
        setTimeout(() => {
          if (this.running && !this.cycling) {
            this.triggerReason = 'delegation-complete';
            this.runCycle();
          }
        }, 100);
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

  /**
   * Adaptive Cycle Depth — infer context weight from trigger + cycle state.
   * Returns one of 4 context depths:
   *   minimal  (~5K)  — delegation-drain, only need delegation results + tasks
   *   light    (~15K) — DM-triggered, fast response with essential context
   *   focused  (~30K) — default, perception-aware context
   *   full     (~50K) — reserved for future strategic deep cycles
   */
  private inferCycleWeight(trigger: string, opts: {
    hasNewInbox: boolean;
    perceptionChanged: boolean;
  }): 'minimal' | 'light' | 'focused' | 'full' {
    // Delegation drain — only need to see results, minimal context
    if (trigger.startsWith('delegation') && !opts.hasNewInbox) {
      return 'minimal';
    }

    // DM reply — light context (existing behavior)
    if (['telegram', 'room', 'chat', 'direct-message'].some(s => trigger.startsWith(s))) {
      return 'light';
    }

    // Heartbeat/cron without new info — routine check-in, light context suffices
    if (['heartbeat', 'cron'].some(s => trigger.startsWith(s)) && !opts.hasNewInbox && !opts.perceptionChanged) {
      return 'light';
    }

    // Continuation — keep focused depth
    if (trigger.startsWith('continuation')) {
      return 'focused';
    }

    // Perception changed or new inbox — need focused awareness
    if (opts.perceptionChanged || opts.hasNewInbox) {
      return 'focused';
    }

    // Default — light for routine cycles
    return 'light';
  }

  /** Detect cycle mode for JIT skill loading — delegates to prompt-builder.ts */
  private detectCycleMode(
    context: string,
    triggerReason: string | null,
  ): import('./memory.js').CycleMode {
    return detectCycleModeFn(context, triggerReason, this.consecutiveLearnCycles);
  }

  /** Autonomous Mode — delegates to prompt-builder.ts */
  private async buildAutonomousPrompt(): Promise<string> {
    const mode = getMode();
    const state: PromptBuilderState = {
      lastAutonomousActions: this.lastAutonomousActions,
      consecutiveLearnCycles: this.consecutiveLearnCycles,
      lastValidConfig: this.lastValidConfig,
      controlMode: mode.mode,
    };
    const result = await buildAutonomousPromptFn(state);
    this.lastValidConfig = result.lastValidConfig;
    return result.prompt;
  }

  /** Load behavior config — delegates to prompt-builder.ts */
  private loadBehaviorConfig(): BehaviorConfig | null {
    const result = loadBehaviorConfigFn(this.lastValidConfig);
    this.lastValidConfig = result.lastValidConfig;
    return result.config;
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

// Post-cycle standalone functions extracted to src/cycle-tasks.ts:
// parseBehaviorConfig, parseInterval, checkApprovedProposals,
// resolveStaleConversationThreads, autoEscalateOverdueTasks,
// autoCommitMemoryFiles, autoCommitExternalRepos,
// writeContextSnapshot

// Inbox processing extracted to src/inbox-processor.ts

// Prompt builders extracted to src/prompt-builder.ts:
// parseScheduleInterval, detectCycleMode, loadBehaviorConfig,
// buildPromptFromConfig, buildFallbackAutonomousPrompt, buildAutonomousPrompt
