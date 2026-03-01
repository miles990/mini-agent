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
import { callClaude, preemptLoopCycle, isLoopBusy, bumpLoopGeneration } from './agent.js';
import { getMemory } from './memory.js';
import { getLogger } from './logging.js';
import { diagLog, slog } from './utils.js';
import { parseTags } from './dispatcher.js';
import type { ParsedTags } from './types.js';
import { notifyTelegram, markInboxAllProcessed, getLastAlexMessageId } from './telegram.js';
import { eventBus } from './event-bus.js';
import type { AgentEvent } from './event-bus.js';
import { perceptionStreams } from './perception-stream.js';
import { getCurrentInstanceId, getInstanceDir } from './instance.js';
import { githubAutoActions } from './github.js';
import { runFeedbackLoops } from './feedback-loops.js';
import { runCoachCheck } from './coach.js';
import { extractCommitments, updateCommitments } from './commitments.js';
import { drainCronQueue } from './cron.js';
import {
  updateTemporalState, buildThreadsPromptSection,
  startThread, progressThread, completeThread, pauseThread,
} from './temporal.js';
import { extractNextItems } from './triage.js';
import { NEXT_MD_PATH } from './telegram.js';
import { withFileLock } from './filelock.js';
import { readPendingInbox, markAllInboxProcessed, markInboxProcessed, detectModeFromInbox, formatInboxSection, writeInboxItem, hasRecentUnrepliedTelegram } from './inbox.js';
import { runHousekeeping, autoPushIfAhead, trackTaskProgress, markTaskProgressDone, buildTaskProgressSection } from './housekeeping.js';
import { isEnabled, trackStart } from './features.js';
import { writeRoomMessage } from './observability.js';
import { readMemory } from './memory.js';
import { getMode } from './mode.js';
import { router, createEvent, classifyTrigger, logRoute, Priority } from './event-router.js';
import type { LoopState } from './event-router.js';
import {
  hesitate, applyHesitation, loadErrorPatterns, saveHeldTags,
  drainHeldTags, buildHeldTagsPrompt, logHesitation,
} from './hesitation.js';
import { cleanupTasks as cleanupDelegations } from './delegation.js';

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
  // ── Side Effect Tracking (Layer 4) ──
  sideEffects?: string[];
  tagsProcessed?: string[];
  pendingPriorityInfo?: string | null;
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

function loadStaleCheckpoint(): { info: string; triggerReason: string | null; lastAction: string | null; lastAutonomousActions: string[]; sideEffects?: string[] } | null {
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
    const sideEffectHint = data.sideEffects?.length
      ? `\nAlready completed side effects (DO NOT repeat): ${data.sideEffects.join('; ')}`
      : '';
    const info = `Mode: ${data.mode}, Trigger: ${data.triggerReason ?? 'unknown'}, Prompt: ${data.promptSnippet}${partial}${sideEffectHint}`;

    slog('RESUME', `Detected interrupted cycle from ${data.startedAt}${data.sideEffects?.length ? ` (${data.sideEffects.length} side effects)` : ''}`);
    fs.unlinkSync(filePath);

    return {
      info,
      triggerReason: data.triggerReason,
      lastAction: data.lastAction,
      lastAutonomousActions: data.lastAutonomousActions,
      sideEffects: data.sideEffects,
    };
  } catch {
    // JSON parse failure or other error — ignore (degrade gracefully)
    try { if (filePath) fs.unlinkSync(filePath); } catch { /* */ }
    return null;
  }
}

// =============================================================================
// Work Journal (cross-restart context continuity)
// =============================================================================

interface WorkJournalEntry {
  ts: string;
  cycle: number;
  action: string;
  trigger: string | null;
  tags: string[];
  sideEffects: string[];
}

function getWorkJournalPath(): string | null {
  try {
    const instanceId = getCurrentInstanceId();
    if (!instanceId) return null;
    return path.join(getInstanceDir(instanceId), 'work-journal.jsonl');
  } catch { return null; }
}

function writeWorkJournal(entry: WorkJournalEntry): void {
  const filePath = getWorkJournalPath();
  if (!filePath) return;
  try {
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
    // Trim to last 50 entries to prevent unbounded growth
    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
    if (lines.length > 50) {
      fs.writeFileSync(filePath, lines.slice(-50).join('\n') + '\n', 'utf-8');
    }
  } catch { /* fire-and-forget */ }
}

function loadWorkJournal(limit: number = 5): WorkJournalEntry[] {
  const filePath = getWorkJournalPath();
  if (!filePath || !fs.existsSync(filePath)) return [];
  try {
    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
    return lines.slice(-limit).map(l => JSON.parse(l) as WorkJournalEntry);
  } catch { return []; }
}

function formatWorkJournalContext(entries: WorkJournalEntry[]): string {
  const lines = entries.map(e => {
    const tagsStr = e.tags.length > 0 ? ` [${e.tags.join(',')}]` : '';
    const effects = e.sideEffects.length > 0 ? ` → ${e.sideEffects.join('; ')}` : '';
    return `- #${e.cycle} (${e.trigger ?? 'auto'}): ${e.action.slice(0, 200)}${tagsStr}${effects}`;
  });
  return `Work journal from before restart (continue relevant work, honor commitments):\n${lines.join('\n')}`;
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
  pendingPriority?: { reason: string; waitingMs: number };
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

/** Parse human-friendly interval string (e.g. "30m", "2h", "5m", "now") to ms. Returns 0 on invalid. */
function parseScheduleInterval(s: string): number {
  // "now" = continuation signal — run next cycle after brief cooldown
  if (s.trim().toLowerCase() === 'now') return 30_000;
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
  /** One-shot flag: allows a single cycle to run while paused (calm mode direct messages) */
  private calmWake = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cycleCount = 0;
  private currentInterval: number;
  private lastCycleAt: string | null = null;
  private lastAction: string | null = null;
  private nextCycleAt: string | null = null;
  private cycling = false;

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

  // ── Behavior config resilience ──
  private lastValidConfig: BehaviorConfig | null = null;

  // ── Cross-cycle state (only last cycle, no accumulation) ──
  private previousCycleInfo: string | null = null;
  private workJournalContext: string | null = null;

  // ── Interrupted cycle resume (Phase 1b + 1c) ──
  private interruptedCycleInfo: string | null = null;

  // ── Quick Reply (parallel response during cycling) ──
  private quickReplyInFlight = false;
  private quickReplyRecord: { question: string; answer: string; source: string; ts: string } | null = null;

  // ── Per-perception change detection (Phase 4) ──
  private lastPerceptionVersion = -1;

  // ── Event-Driven Scheduling (Phase 2b) ──
  private triggerReason: string | null = null;
  private lastCycleTime = 0;
  private static readonly MIN_CYCLE_INTERVAL = 30_000;           // 30s throttle

  // ── Direct Message Wake (trigger loop cycle on direct messages: telegram, room, chat) ──
  private directMessageWakeQueue = 0;
  private lastTelegramWake = 0;
  private busyRetryCount = 0;
  private static readonly TELEGRAM_WAKE_THROTTLE = 5_000;        // 5s throttle

  // ── Cooperative Yield (Layer 3) ──
  private pendingPriority: { reason: string; arrivedAt: number; messageCount: number } | null = null;
  private safetyValveTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly SAFETY_VALVE_TIMEOUT = 300_000; // 5min

  // ── Interrupt storm guard (Layer 2) ──
  private lastPriorityDrainAt = 0;
  private static readonly PRIORITY_COOLDOWN = 10_000; // 同類 10s 冷卻

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
      if (agentEvent.type === 'trigger:telegram' && agentEvent.data?.source === 'mark-processed') return;
      const { source } = classifyTrigger(agentEvent.type, agentEvent.data);
      if (!AgentLoop.DIRECT_MESSAGE_SOURCES.has(source)) return;
      this.calmWake = true;
      slog('LOOP', `[calm-wake] Direct message bypasses pause: ${agentEvent.type}`);
    }

    // mark-processed is a perception cache refresh, not a real message.
    // Must bypass router entirely — otherwise it updates the cooldown timer for 'telegram'
    // source, causing real P0 telegram-user events arriving within 10s to be deferred.
    if (agentEvent.type === 'trigger:telegram' && agentEvent.data?.source === 'mark-processed') return;

    const now = Date.now();
    const { source, priority } = classifyTrigger(agentEvent.type, agentEvent.data);

    // Source-specific throttle (preserves existing behavior)
    if (source === 'telegram' && priority === Priority.P0) {
      if (now - this.lastTelegramWake < AgentLoop.TELEGRAM_WAKE_THROTTLE) return;
      this.lastTelegramWake = now;
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
    // Quick Reply: independent of router priority — any direct message during long-running
    // cycle gets a parallel lightweight response without interrupting the cycle
    const cycleAge = now - this.lastCycleTime;
    if (cycleAge > 10_000 && AgentLoop.DIRECT_MESSAGE_SOURCES.has(event.source)) {
      const text = (agentEvent.data?.text as string) ?? '';
      const roomMsgId = (agentEvent.data?.roomMsgId as string) ?? undefined;
      if (text) {
        this.quickReply(event.source, text, roomMsgId).catch(() => {});
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

        // Cooperative yield: set pendingPriority, let cycle finish naturally
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
        this.scheduleSafetyValve();
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
   * Quick Reply — parallel response while a cycle is in progress.
   * Uses minimal context (same as /api/ask) to reply immediately without
   * interrupting the current cycle. Fire-and-forget.
   */
  private async quickReply(source: string, text: string, replyTo?: string): Promise<void> {
    if (this.quickReplyInFlight) return; // one at a time
    this.quickReplyInFlight = true;

    try {
      const memory = getMemory();
      let context = await memory.buildContext({ mode: 'minimal' });

      // FTS5 memory search — dynamic context enrichment based on question
      const ftsResults = await memory.searchMemory(text, 8);
      if (ftsResults.length > 0) {
        const relevantEntries = ftsResults.map(r => `[${r.source}] ${r.content}`).join('\n');
        context += `\n\n<relevant_memory>\n${relevantEntries}\n</relevant_memory>`;
      }

      // Append MEMORY.md excerpt (fallback: FTS5 may not index everything)
      const memContent = await readMemory();
      if (memContent) {
        context += `\n\n<memory>\n${memContent.slice(0, 2000)}\n</memory>`;
      }

      // Append today's recent chat room messages
      const today = new Date().toISOString().slice(0, 10);
      const convPath = path.join(process.cwd(), 'memory', 'conversations', `${today}.jsonl`);
      try {
        const raw = fs.readFileSync(convPath, 'utf-8');
        const msgs = raw.split('\n').filter(Boolean).map(line => {
          try { return JSON.parse(line) as { from: string; text: string; ts?: string }; } catch { return null; }
        }).filter(Boolean).slice(-15);
        if (msgs.length > 0) {
          const chatLines = msgs.map(m => `[${m!.ts ?? ''}] (${m!.from}) ${m!.text}`).join('\n');
          context += `\n\n<chat_room_today>\n${chatLines}\n</chat_room_today>`;
        }
      } catch { /* no conversations today */ }

      // Cached perception — inject key sections (free, already collected)
      try {
        const cached = perceptionStreams.getCachedResults();
        const importantNames = ['state-changes', 'tasks', 'telegram-inbox', 'chat-room-inbox', 'github-issues'];
        const relevant = cached.filter(r => importantNames.includes(r.name));
        if (relevant.length > 0) {
          const perceptionLines = relevant.map(r => `<${r.name}>\n${r.output!.slice(0, 1000)}\n</${r.name}>`).join('\n');
          context += `\n\n<cached_perception>\n${perceptionLines}\n</cached_perception>`;
        }
      } catch { /* perception not available */ }

      // Reserved mode: include working memory
      if (getMode().mode === 'reserved') {
        const innerPath = path.join(memory.getMemoryDir(), 'inner-notes.md');
        try { const c = fs.readFileSync(innerPath, 'utf-8'); if (c.trim()) context += `\n\n<inner_notes>\n${c.trim()}\n</inner_notes>`; } catch {}
        const trackingPath = path.join(memory.getMemoryDir(), 'tracking-notes.md');
        try { const c = fs.readFileSync(trackingPath, 'utf-8'); if (c.trim()) context += `\n\n<tracking_notes>\n${c.trim()}\n</tracking_notes>`; } catch {}
      }

      context += `\n\n<quick_reply_mode>\n你正在深度思考中，同時有人傳了訊息。這是快速回覆模式——直接對話回應，不需要做 OODA 分析。你的深度思考會繼續進行，之後有需要補充的可以再說。\n</quick_reply_mode>`;

      const { response } = await callClaude(text, context, 1, { source: 'ask' });

      // Parse tags, extract clean content
      const tags = parseTags(response);
      const answer = tags.cleanContent || response;

      // Handle <kuro:remember> tags (fire-and-forget)
      for (const rem of tags.remembers) {
        if (rem.topic) {
          memory.appendTopicMemory(rem.topic, rem.content, rem.ref).catch(() => {});
        } else {
          memory.appendMemory(rem.content).catch(() => {});
        }
      }

      // Send reply to the appropriate channel
      if (source === 'telegram') {
        notifyTelegram(answer, getLastAlexMessageId() ?? undefined).catch(() => {});
      }
      // Always write to chat room (visible to all)
      await writeRoomMessage('kuro', answer, replyTo);

      // Record for next cycle awareness
      this.quickReplyRecord = { question: text, answer: answer.slice(0, 300), source, ts: new Date().toISOString() };

      slog('LOOP', `[quick-reply] Replied to ${source} (${answer.length} chars) while cycle in progress`);
      eventBus.emit('action:loop', { event: 'quick-reply', source, answerLength: answer.length });
    } catch (err) {
      slog('ERROR', `[quick-reply] Failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      this.quickReplyInFlight = false;
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

    // mushi instant routing — DM sources with message text get classified
    const messageText = (agentEvent.data?.text as string) ?? '';
    if (isEnabled('mushi-triage') && AgentLoop.DIRECT_MESSAGE_SOURCES.has(event.source) && messageText) {
      const roomMsgId = (agentEvent.data?.roomMsgId as string) ?? undefined;
      this.mushiInstantRoute(event.source, messageText, roomMsgId);
      return;
    }

    // If agent process is busy (held by cron etc), preempt first
    if (isLoopBusy()) {
      slog('LOOP', `[unified] Preempting busy state for ${event.source}`);
      preemptLoopCycle();
      setTimeout(() => {
        this.triggerReason = `${event.source} (unified)`;
        this.runCycle();
      }, 500);
      return;
    }

    // Build trigger reason
    const detail = Object.keys(agentEvent.data).length > 0
      ? `: ${JSON.stringify(agentEvent.data).slice(0, 100)}`
      : '';
    this.triggerReason = event.source === 'telegram' ? 'telegram-user' : `${event.source}${detail}`;

    this.runCycle();
  }

  /**
   * mushi instant routing — three-tier progressive response:
   * T1: mushi instant-reply (~1-2s, fire-and-forget) → quick ack to Telegram
   * T2: triage decides depth — instant → quickReply (~15s) / wake → OODA (~30-300s)
   */
  private async mushiInstantRoute(source: string, text: string, replyTo?: string): Promise<void> {
    // T1: Fire mushi instant reply (non-blocking, ~1-2s)
    // Sends a quick first response to Telegram while T2 processes deeper
    const alexMsgId = source === 'telegram' ? getLastAlexMessageId() ?? undefined : undefined;
    this.fireMushibInstantReply(text, alexMsgId).catch(() => {});

    try {
      const metadata: Record<string, unknown> = { messageText: text };
      if (this.lastCycleTime > 0) {
        metadata.lastThinkAgo = Math.round((Date.now() - this.lastCycleTime) / 1000);
      }

      const res = await fetch(AgentLoop.MUSHI_TRIAGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trigger: source, source, metadata }),
        signal: AbortSignal.timeout(3000),
      });

      if (!res.ok) throw new Error(`mushi ${res.status}`);
      const result = await res.json() as { action?: string; reason?: string; latencyMs?: number };

      if (result.action === 'instant') {
        slog('MUSHI', `⚡ instant: ${source} → quickReply (${result.latencyMs}ms) — ${result.reason}`);
        eventBus.emit('log:info', { tag: 'mushi-instant', msg: `${source} → instant (${result.latencyMs}ms) — ${result.reason}`, source, latencyMs: result.latencyMs, reason: result.reason });
        // T2: quickReply for deeper response (Claude /api/ask)
        await this.quickReply(source, text, replyTo);
        return;
      }

      // wake or unknown → T2: normal OODA cycle
      slog('MUSHI', `✅ wake: ${source} → cycle (${result.latencyMs}ms) — ${result.reason}`);
      this.triggerReason = source === 'telegram' ? 'telegram-user' : source;
      this.runCycle();
    } catch (err) {
      // Fail-open: mushi error → normal cycle directly
      slog('MUSHI', `⚡ instant-route failed (${err instanceof Error ? err.message : 'unknown'}), falling back to cycle`);
      this.triggerReason = source === 'telegram' ? 'telegram-user' : source;
      this.runCycle();
    }
  }

  private static readonly MUSHI_INSTANT_REPLY_URL = 'http://localhost:3000/api/instant-reply';

  /**
   * Fire mushi instant reply — non-blocking T1 quick response (~1-2s).
   * Sends directly to Telegram as a quick first acknowledgement.
   */
  private async fireMushibInstantReply(text: string, replyToMsgId?: number): Promise<void> {
    try {
      const res = await fetch(AgentLoop.MUSHI_INSTANT_REPLY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) throw new Error(`mushi instant-reply ${res.status}`);
      const result = await res.json() as { ok?: boolean; reply?: string; latencyMs?: number };

      if (result.ok && result.reply) {
        slog('MUSHI', `💨 instant-reply: "${result.reply.slice(0, 60)}" (${result.latencyMs}ms)`);
        // Send T1 reply to Telegram (quoting Alex's message)
        notifyTelegram(result.reply, replyToMsgId).catch(() => {});
        // Also write to chat room for visibility
        writeRoomMessage('kuro', `[T1] ${result.reply}`).catch(() => {});
      }
    } catch (err) {
      // Silent fail — T2 will still handle the message
      slog('MUSHI', `💨 instant-reply failed: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }

  // ---------------------------------------------------------------------------
  // mushi Triage — active mode (skip cycle if mushi says skip)
  // ---------------------------------------------------------------------------

  private static readonly MUSHI_TRIAGE_URL = 'http://localhost:3000/api/triage';

  /** Ask mushi to classify a trigger as wake/skip. Returns decision or null (offline/error = fail-open). */
  private async mushiTriage(source: string, data: Record<string, unknown>): Promise<'wake' | 'skip' | null> {
    try {
      const metadata: Record<string, unknown> = {};
      // Include last think age for context
      if (this.lastCycleTime > 0) {
        metadata.lastThinkAgo = Math.round((Date.now() - this.lastCycleTime) / 1000);
      }
      // Auto-commit detection from data
      if (data.source === 'auto-commit' || String(data.detail ?? '').includes('auto-commit')) {
        metadata.isAutoCommit = true;
      }
      // Last action type: helps mushi distinguish "just idled" vs "just acted"
      if (this.lastAction) {
        const idle = /no action|穩態|無需行動|nothing to do/i.test(this.lastAction);
        metadata.lastActionType = idle ? 'idle' : 'action';
      } else {
        metadata.lastActionType = 'none';
      }
      // Whether perceptions changed since last build
      metadata.perceptionChanged = perceptionStreams.version !== this.lastPerceptionVersion;
      // Cycle count for context
      metadata.cycleCount = this.cycleCount;

      const body = JSON.stringify({
        trigger: source,
        source: String(data.source ?? source),
        metadata,
      });

      const res = await fetch(AgentLoop.MUSHI_TRIAGE_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(3000),
      });

      if (!res.ok) return null;
      const result = await res.json() as { action?: string; reason?: string; latencyMs?: number; method?: string };

      const emoji = result.action === 'skip' ? '⏭' : '✅';
      slog('MUSHI', `${emoji} triage: ${source} → ${result.action} (${result.latencyMs}ms ${result.method}) — ${result.reason}`);
      eventBus.emit('log:info', { tag: 'mushi-triage', msg: `${source} → ${result.action} (${result.latencyMs}ms ${result.method})`, source, action: result.action, latencyMs: result.latencyMs, method: result.method });
      return (result.action === 'skip' || result.action === 'wake') ? result.action as 'wake' | 'skip' : null;
    } catch {
      // mushi offline or timeout — fail-open (proceed with cycle)
      return null;
    }
  }

  /** Event handler — bound to `this` for subscribe/unsubscribe */
  private handleTrigger = (event: AgentEvent): void => {
    return this.handleUnifiedEvent(event);
  };


  constructor(config: Partial<AgentLoopConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentInterval = this.config.intervalMs;
  }

  // ---------------------------------------------------------------------------
  // Safety Valve (Cooperative Yield fallback — kill after 5min)
  // ---------------------------------------------------------------------------

  private scheduleSafetyValve(): void {
    if (this.safetyValveTimer) return;
    const arrivedAt = this.pendingPriority?.arrivedAt ?? Date.now();
    this.safetyValveTimer = setTimeout(() => {
      this.safetyValveTimer = null;
      if (!this.cycling || !this.pendingPriority) return;
      slog('LOOP', `Safety valve: ${Math.round((Date.now() - arrivedAt) / 1000)}s, force-killing`);
      eventBus.emit('action:loop', { event: 'safety-valve', elapsed: Math.round((Date.now() - arrivedAt) / 1000) });
      const { preempted, partialOutput } = preemptLoopCycle();
      if (preempted) {
        this.interruptedCycleInfo = `Mode: ${this.currentMode}, Prompt: ${partialOutput?.slice(0, 200) ?? 'unknown'}`;
      } else {
        bumpLoopGeneration();
      }
      this.directMessageWakeQueue++;
    }, AgentLoop.SAFETY_VALVE_TIMEOUT);
  }

  private clearSafetyValve(): void {
    if (this.safetyValveTimer) { clearTimeout(this.safetyValveTimer); this.safetyValveTimer = null; }
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

    // Phase 1d: Load work journal for restart resilience
    const journalEntries = loadWorkJournal(5);
    if (journalEntries.length > 0) {
      this.workJournalContext = formatWorkJournalContext(journalEntries);
      slog('JOURNAL', `Loaded ${journalEntries.length} work journal entries from previous instance`);
    }

    // Achievement system: retroactive unlock on first boot
    import('./achievements.js').then(m => m.retroactiveUnlock()).catch(() => {});

    eventBus.on('trigger:*', this.handleTrigger);

    // Run first cycle after short warmup (let perception streams initialize)
    // instead of waiting the full heartbeat interval
    const STARTUP_DELAY = 15_000; // 15s warmup
    setTimeout(() => {
      if (this.running && !this.paused && !this.cycling) {
        // If there are recent unseen telegram messages (within 4h), treat startup as telegram-priority
        // so Kuro replies to Alex before doing generic autonomous work
        if (hasRecentUnrepliedTelegram(4)) {
          this.triggerReason = 'telegram-user (startup-recovery)';
          slog('LOOP', 'Startup: recent unseen telegram detected → telegram-priority cycle');
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
    this.running = false;
    eventBus.off('trigger:*', this.handleTrigger);
    this.clearTimer();
    this.clearSafetyValve();
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
    if (!this.running || (this.paused && !this.calmWake)) return;
    this.calmWake = false;

    this.lastCycleTime = Date.now();

    // mushi triage — active mode: skip cycle if mushi says skip
    // DM sources always bypass (hard rule). Fail-open if mushi offline.
    // Placed here (not in handleEvent) so ALL cycle entry points are covered:
    // heartbeat timer, priority drain, direct-message queue, and event-driven triggers
    const reason = this.triggerReason ?? '';
    const isDM = [...AgentLoop.DIRECT_MESSAGE_SOURCES].some(s => reason.startsWith(s))
      || reason.startsWith('direct-message');
    if (isEnabled('mushi-triage') && !isDM && reason) {
      const triageSource = reason.split(/[:(]/)[0].trim();
      if (triageSource === 'alert') {
        slog('MUSHI', `✅ alert bypasses triage (hard rule)`);
      } else {
        const decision = await this.mushiTriage(triageSource, { source: reason, detail: reason });
        if (decision === 'skip') {
          slog('MUSHI', `⏭ Skipping cycle — trigger: ${triageSource}`);
          if (this.running && !this.paused) {
            this.scheduleHeartbeat();
          }
          return;
        }
      }
    }

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

      // ── Inbox recovery: upgrade to telegram-priority if pending telegram items exist ──
      // Defense-in-depth: catches edge cases where trigger:telegram-user didn't start the cycle
      // (e.g. arrived during pause, process restart, or any future routing bug).
      // Must run before isTelegramUser so all downstream checks see the correct value.
      const inboxItemsEarly = readPendingInbox();
      if (inboxItemsEarly.some(i => i.source === 'telegram') && !this.triggerReason?.startsWith('telegram-user')) {
        this.triggerReason = 'telegram-user (inbox-recovery)';
        slog('LOOP', 'Inbox recovery: pending telegram items detected → upgrading to telegram-priority');
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

      // Quick Reply record: if a parallel reply was sent during the previous cycle
      const quickReplySuffix = this.quickReplyRecord
        ? `\n\nDuring your previous cycle, a ${this.quickReplyRecord.source} message arrived and was answered via quick-reply (parallel, lightweight). Question: "${this.quickReplyRecord.question.slice(0, 200)}" → Your quick answer: "${this.quickReplyRecord.answer.slice(0, 200)}". Only follow up if you have something substantive to add.`
        : '';
      this.quickReplyRecord = null; // one-shot

      // Rule-based triage from unified inbox（零 LLM 成本）
      // Re-use inboxItemsEarly — already read above for inbox-recovery check
      const inboxItems = inboxItemsEarly;
      const cycleIntent = detectModeFromInbox(inboxItems, currentTriggerReason);

      // Priority prefix: 強制先處理 NEXT.md pending items 或 Chat Room priority 訊息
      const isTelegramUserCycle = currentTriggerReason?.startsWith('telegram-user') ?? false;
      const isRoomPriorityCycle = currentTriggerReason?.startsWith('room') ?? false;
      let nextPendingItems: string[] = [];
      try {
        if (fs.existsSync(NEXT_MD_PATH)) {
          nextPendingItems = extractNextItems(fs.readFileSync(NEXT_MD_PATH, 'utf-8'));
        }
      } catch { /* non-critical */ }

      // Priority prefix 在 telegram-user 或 room cycle 觸發
      let priorityPrefix = '';
      if (isTelegramUserCycle) {
        if (nextPendingItems.length > 0) {
          const itemsPreview = nextPendingItems.slice(0, 3).map(i => `  「${i.slice(0, 80)}」`).join('\n');
          priorityPrefix = `🚨 THIS CYCLE WAS TRIGGERED BY ALEX'S TELEGRAM MESSAGE. YOU MUST REPLY.\n\nAlex 的訊息（在 NEXT.md）：\n${itemsPreview}\n\n⚠️ 回覆順序（強制）：1) 先發出 <kuro:chat>回覆內容</kuro:chat> 直接回答 Alex 的問題，2) 再用 <kuro:done>描述</kuro:done> 標記完成。不發 <kuro:chat> 就不算回覆。處理完 Alex 的問題才做自主行動。\n禁止把 Alex 的問題重新詮釋為自主任務。Alex 問什麼就回答什麼。\n\n## Self-Challenge Protocol（回覆 Alex 前的強制自我質疑）\n回答 Alex 的問題時，在 <kuro:chat> 之前先做這三個檢查（寫在 <kuro:action> 內）：\n1. **來源廣度** — 我查了幾個來源？只有一個的話，再查一個不同的\n2. **根因 vs 症狀** — 我描述的是「什麼壞了」還是「為什麼壞了」？往上追問一層 why\n3. **反例搜尋** — 什麼證據會推翻我的結論？花 30 秒找反例\n如果三個都做了，在 <kuro:action> 中加 ## Challenge: checked。如果某項做不到，寫明原因。\n\n`;
        } else {
          // telegram-user 觸發但 NEXT.md 沒 pending items（可能已被 triage 清掉）
          priorityPrefix = `🚨 THIS CYCLE WAS TRIGGERED BY ALEX'S TELEGRAM MESSAGE. Check <telegram-inbox> or <inbox> for Alex's message and reply with <kuro:chat>...</kuro:chat>.\n\n## Self-Challenge Protocol（回覆 Alex 前的強制自我質疑）\n回答前做三個檢查：1) 來源廣度（查了幾個來源？）2) 根因 vs 症狀（往上追問 why）3) 反例搜尋（什麼會推翻結論？）\n做完在 <kuro:action> 加 ## Challenge: checked。\n\n`;
        }
      } else {
        // Non-telegram cycle: check for pending/unaddressed Chat Room messages
        // Room-triggered cycles get strong priority; other cycles get soft reminder
        try {
          const inboxContent = fs.existsSync(CHAT_ROOM_INBOX_PATH)
            ? fs.readFileSync(CHAT_ROOM_INBOX_PATH, 'utf-8') : '';
          const pendingLines = inboxContent.match(/## Pending\n([\s\S]*?)(?=## (?:Unaddressed|Processed))/)?.[1]
            ?.split('\n').filter(l => l.startsWith('- [')) ?? [];
          const unaddressedLines = inboxContent.match(/## Unaddressed\n([\s\S]*?)(?=## Processed)/)?.[1]
            ?.split('\n').filter(l => l.startsWith('- [')) ?? [];
          const allPending = [...pendingLines, ...unaddressedLines];
          if (allPending.length > 0) {
            const preview = allPending.slice(0, 5).map(l => `  ${l}`).join('\n');
            if (isRoomPriorityCycle) {
              // Room-triggered: strong priority (same as telegram)
              priorityPrefix = `📩 THIS CYCLE WAS TRIGGERED BY A CHAT ROOM MESSAGE. Please respond to pending messages first.\n\nChat Room 待回覆訊息：\n${preview}\n\n⚠️ 回覆順序：1) 先用 <kuro:chat>回覆內容</kuro:chat> 回應 Chat Room 的問題，2) 再做自主行動。如果訊息包含具體問題，請逐一回答，不要忽略。\n\n`;
            } else {
              // Other cycles (heartbeat/workspace/cron): soft reminder for unaddressed messages
              priorityPrefix = `📩 REMINDER: There are ${allPending.length} unaddressed Chat Room message(s). Please respond with <kuro:chat>...</kuro:chat> before or during your autonomous activities.\n\n${preview}\n\n`;
            }
          }
        } catch { /* non-critical */ }
      }

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

      const prompt = priorityPrefix + await this.buildAutonomousPrompt() + triageHint + triggerSuffix + previousCycleSuffix + interruptedSuffix + quickReplySuffix + hesitationReviewSuffix + workJournalSuffix;

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

      // ── Hesitation Signal（確定性，零 API call）──
      let hesitationScheduleReview = false;
      if (isEnabled('hesitation-signal')) {
        const errorPatterns = loadErrorPatterns();
        const hesitationResult = hesitate(response, tags, errorPatterns);
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
        eventBus.emit('action:memory', { content: rem.content, topic: rem.topic });
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

      // ── Telegram Reply（OODA-Only：telegram-user 觸發時自動回覆 Alex） ──
      // Must run BEFORE action:chat emission to prevent duplicate sends
      let didReplyToTelegram = false;
      if (currentTriggerReason?.startsWith('telegram-user') && tags.chats.length > 0) {
        const replyContent = tags.chats.map(c => c.text).join('\n\n');
        if (replyContent) {
          didReplyToTelegram = true;
          notifyTelegram(replyContent, getLastAlexMessageId() ?? undefined).catch((err) => {
            slog('LOOP', `Telegram reply failed: ${err instanceof Error ? err.message : err}`);
          });
          cycleSideEffects.push(`chat:${replyContent.slice(0, 60)}`);
          cycleTagsProcessed.push('CHAT');
          // Clear chats — already sent via OODA reply, skip action:chat to prevent duplicate
          tags.chats.length = 0;
        }
      }

      for (const chat of tags.chats) {
        eventBus.emit('action:chat', { text: chat.text, reply: chat.reply });
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
        notifyTelegram(askMsg, getLastAlexMessageId() ?? undefined).catch((err) => {
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

      // ── Process <kuro:done> tags — remove completed items from NEXT.md ──
      if (tags.dones.length > 0) {
        markNextItemsDone(tags.dones).catch(() => {});
        // <kuro:done> → task-progress linkage
        for (const done of tags.dones) {
          markTaskProgressDone(done);
        }
      }

      // ── Process <kuro:progress> tags — task progress tracking ──
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

      // <kuro:schedule> tag — Kuro 自主排程覆蓋
      if (tags.schedule) {
        const isNow = tags.schedule.next.trim().toLowerCase() === 'now';
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

      // ── Write Work Journal (fire-and-forget, survives restart) ──
      writeWorkJournal({
        ts: new Date().toISOString(),
        cycle: this.cycleCount,
        action: action || 'no-action',
        trigger: currentTriggerReason,
        tags: cycleTagsProcessed,
        sideEffects: cycleSideEffects,
      });

      // ── Update Temporal State (fire-and-forget) ──
      const topicList = tags.remembers.filter(r => r.topic).map(r => r.topic!);
      const touchedTopics = topicList.length > 0 ? topicList : undefined;
      updateTemporalState({
        mode: this.currentMode,
        action,
        topics: touchedTopics,
      }).catch(() => {});

      // ── Telegram Reply fallback（telegram-user 但無 <kuro:chat> tag → 用 cleanContent） ──
      // Use didReplyToTelegram instead of tags.chats.length === 0 because chats are
      // cleared at line 1113 after sending. The old check would fire the fallback
      // even when we already replied, causing duplicate messages when cleanContent
      // is non-empty (e.g. when backtick-quoted tag references corrupt the stripping).
      if (currentTriggerReason?.startsWith('telegram-user') && !didReplyToTelegram) {
        let fallbackContent = tags.cleanContent.replace(/<kuro:action>[\s\S]*?<\/kuro:action>/g, '').trim();
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
          notifyTelegram(capped, getLastAlexMessageId() ?? undefined).catch((err) => {
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
      if (isEnabled('approved-proposals')) await checkApprovedProposals();

      // Mark all pending inbox messages as processed（cycle saw them all）
      // didReplyToTelegram: true → 'replied', false → 'seen' (honest distinction)
      markInboxAllProcessed(didReplyToTelegram);
      markClaudeCodeInboxProcessed();
      markChatRoomInboxProcessed(response, tags, action);

      // Mark unified inbox items as processed.
      // Non-telegram cycles must NOT touch telegram-source items — leave them pending
      // so the telegram drain cycle can properly process them with priority prefix.
      // If we mark them 'seen' here, the drain cycle's markAllInboxProcessed('replied')
      // won't find them (it only updates 'pending' items), leaving them stuck at 'seen'
      // even when Kuro actually replied.
      const isTelegramCycle = currentTriggerReason?.startsWith('telegram-user') ?? false;
      if (isTelegramCycle) {
        markAllInboxProcessed(didReplyToTelegram ? 'replied' : 'seen');
      } else {
        // Only mark non-telegram items; telegram items stay pending for drain cycle
        const allPending = readPendingInbox();
        const nonTelegramPending = allPending.filter(i => i.source !== 'telegram');
        if (nonTelegramPending.length > 0) {
          markInboxProcessed(nonTelegramPending.map(i => i.id), 'seen');
        }
      }

      // Refresh telegram-inbox perception cache so next cycle sees cleared state
      // (telegram-inbox is event-driven, won't refresh unless triggered)
      eventBus.emit('trigger:telegram', { source: 'mark-processed' });

      // Escalate overdue HEARTBEAT tasks（fire-and-forget）
      if (isEnabled('auto-escalate')) {
        const done = trackStart('auto-escalate');
        autoEscalateOverdueTasks().then(() => done(), e => done(String(e)));
      }

      // Auto-commit → then auto-push（sequential，防止 push 在 commit 完成前觸發 CI/CD reset）
      if (isEnabled('auto-commit')) {
        const done = trackStart('auto-commit');
        autoCommitMemory(action)
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

      // Intelligent feedback loops（fire-and-forget）
      if (isEnabled('feedback-loops')) {
        const done = trackStart('feedback-loops');
        runFeedbackLoops(action, currentTriggerReason, context, this.cycleCount).then(() => done(), e => done(String(e)));
      }

      // Action Coach — Haiku behavioral nudges（fire-and-forget, every 3 cycles）
      if (isEnabled('coach')) {
        const done = trackStart('coach');
        runCoachCheck(action, this.cycleCount).then(() => done(), e => done(String(e)));
      }

      // Commitment Binding — 追蹤承諾兌現（fire-and-forget）
      if (isEnabled('commitment-binding')) {
        try {
          extractCommitments(response, this.cycleCount);
          updateCommitments(action, this.cycleCount);
        } catch { /* best effort */ }
      }

      // Resolve stale ConversationThreads（24h TTL + inbox-clear）
      if (isEnabled('stale-threads')) {
        const done = trackStart('stale-threads');
        resolveStaleConversationThreads().then(() => done(), e => done(String(e)));
      }

      // Housekeeping pipeline（fire-and-forget）
      if (isEnabled('housekeeping')) {
        const done = trackStart('housekeeping');
        runHousekeeping().then(() => done(), e => done(String(e)));
      }

      // Delegation cleanup — remove completed tasks >24h（fire-and-forget）
      try { cleanupDelegations(); } catch { /* fire-and-forget */ }

      // Drain one queued cron task（loopBusy now free）
      if (isEnabled('cron-drain')) {
        const done = trackStart('cron-drain');
        drainCronQueue().then(() => done(), e => done(String(e)));
      }

      return action;
    } finally {
      this.cycling = false;
      this.clearSafetyValve();

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
          if (!this.running) return;
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
    // User interaction (telegram, room, chat) → respond (all skills)
    if (triggerReason?.startsWith('telegram-user')
      || triggerReason?.startsWith('room')
      || triggerReason?.startsWith('chat')
      || triggerReason?.startsWith('direct-message')) return 'respond';

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
- Do ONE action per cycle, report with <kuro:action>...</kuro:action>
- Prefix your action with the mode name in brackets, e.g. "[learn-personal]" or "[reflect]"
- When learning: read, think, form YOUR opinion — don't just summarize
- When acting: follow the safety levels in your action-from-learning skill
- If genuinely nothing useful to do, say "No action needed" — don't force it
- Keep it quick (1-2 minutes of work max)
- Use <kuro:remember>insights</kuro:remember> to save insights (include your opinion, not just facts)
- Use <kuro:task>task</kuro:task> to create follow-up tasks if needed
- Use <kuro:impulse>...</kuro:impulse> when a creative thought emerges during learning — capture it before it fades:
  <kuro:impulse>
  我想寫：what you want to create
  驅動力：what triggered this impulse
  素材：material1 + material2
  管道：journal | inner-voice | gallery | devto | chat
  </kuro:impulse>
- Always include source URLs (e.g. "Source: https://...")
- Structure your <kuro:action> with these sections for traceability:
  ## Decision (already at top of response)
  ## What — what you did (1-2 sentences)
  ## Why — why this matters / why now
  ## Thinking — your reasoning process, citing sources and prior knowledge by name
  ## Changed — what files/memory changed (or "none")
  ## Verified — evidence that it worked (commands run, results confirmed)
  Keep each section concise. Not all sections required every cycle — use what's relevant.
- Use paragraphs (separated by blank lines) to structure your <kuro:action> — each paragraph becomes a separate notification
- Use <kuro:chat>message</kuro:chat> to proactively talk to Alex via Telegram (non-blocking — you don't wait for a reply)
- Use <kuro:ask>question</kuro:ask> when you genuinely need Alex's input before proceeding — this creates a tracked conversation thread and sends ❓ to Telegram. Use sparingly: only when a decision truly depends on Alex. Don't use <kuro:ask> for FYI or status updates.
- Use <kuro:show url="URL">description</kuro:show> when you open a webpage or create something Alex should see — this sends a Telegram notification so he doesn't miss it
- Use <kuro:schedule next="Xm" reason="..." /> to set your next cycle interval (min: 30s, max: 4h). Examples:
  <kuro:schedule next="now" reason="continuing multi-step work" />
  <kuro:schedule next="5m" reason="continuing deep research" />
  <kuro:schedule next="45m" reason="waiting for Alex feedback" />
  <kuro:schedule next="2h" reason="night time, no pending messages" />
  "now" = 30s cooldown then immediately run next cycle. Use when you're doing work that needs continuation — you decide when that is.
  If omitted, the system auto-adjusts based on whether you took action.
- Use <kuro:thread> to manage ongoing thought threads:
  <kuro:thread op="start" id="id" title="思路標題">first progress note</kuro:thread>
  <kuro:thread op="progress" id="id">progress note</kuro:thread>
  <kuro:thread op="complete" id="id">completion note</kuro:thread>
  <kuro:thread op="pause" id="id">reason for pausing</kuro:thread>
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
- Do ONE action per cycle, report with <kuro:action>...</kuro:action>
- Start with a brief Decision section:
  ## Decision
  chose: what you're doing (drive — what triggered this choice)
  skipped: what you considered but didn't do (why)
  context: which perception signals influenced you
- When learning: read, think, form YOUR opinion — don't just summarize
- When acting on learning: follow L1/L2/L3 safety levels in your action-from-learning skill
- If genuinely nothing useful to do, say "No action needed" — don't force it
- Keep it quick (1-2 minutes of work max)
- Use <kuro:remember>insights</kuro:remember> to save insights (include your opinion, not just facts)
- Use <kuro:remember topic="topic">text</kuro:remember> to save to a specific topic file
- Use <kuro:task>task</kuro:task> to create follow-up tasks if needed
- Use <kuro:impulse>...</kuro:impulse> when a creative thought emerges — capture it before it fades:
  <kuro:impulse>
  我想寫：what you want to create
  驅動力：what triggered this impulse
  素材：material1 + material2
  管道：journal | inner-voice | gallery | devto | chat
  </kuro:impulse>
- Always include source URLs (e.g. "Source: https://...")
- Use paragraphs (separated by blank lines) to structure your <kuro:action> — each paragraph becomes a separate notification
- Use <kuro:chat>message</kuro:chat> to proactively talk to Alex via Telegram (non-blocking — you don't wait for a reply)
- Use <kuro:ask>question</kuro:ask> when you genuinely need Alex's input before proceeding — creates a tracked thread. Use sparingly.
- Use <kuro:show url="URL">description</kuro:show> when you open a webpage or create something Alex should see
- Use <kuro:done>description</kuro:done> to mark NEXT.md items as completed
- Use <kuro:schedule next="Xm" reason="..." /> to set your next cycle interval (min: 30s, max: 4h). "now" = 30s cooldown for continuation.
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

/** Read conversation JSONL and build reply tracking data.
 * Returns:
 * - replied: Set of message IDs that Kuro has replied to (replyTo values)
 * - msgLookup: Map of "sender\0textPrefix" → message ID (for entries without [msgId]) */
function getRoomReplyStatus(): { replied: Set<string>, msgLookup: Map<string, string> } {
  const replied = new Set<string>();
  const msgLookup = new Map<string, string>();
  try {
    const dateStr = new Date().toISOString().slice(0, 10);
    const jsonlPath = path.join(process.cwd(), 'memory', 'conversations', `${dateStr}.jsonl`);
    if (!fs.existsSync(jsonlPath)) return { replied, msgLookup };
    const lines = fs.readFileSync(jsonlPath, 'utf-8').split('\n').filter(Boolean);
    // parentOf: msgId → replyTo msgId (for transitive parent-addressing)
    const parentOf = new Map<string, string>();
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.from === 'kuro') {
          // Track explicit replyTo
          if (msg.replyTo) replied.add(msg.replyTo);
          // Also track message IDs mentioned in text (e.g. "看到了 #111" or "[2026-02-24-111]")
          if (msg.text) {
            const text = msg.text as string;
            // Full ID: 2026-02-24-NNN
            for (const m of text.matchAll(/\b(\d{4}-\d{2}-\d{2}-\d+)\b/g)) replied.add(m[1]);
            // Short form: #N or #NNN (not part of a full date-prefixed ID)
            for (const m of text.matchAll(/(?<![0-9-])#(\d{1,4})\b/g)) replied.add(`${dateStr}-${m[1]}`);
          }
        }
        // Track reply chain for all messages
        if (msg.id && msg.replyTo) parentOf.set(msg.id, msg.replyTo);
        // Build reverse lookup for non-kuro messages (sender + cleaned text prefix → id)
        if (msg.from && msg.from !== 'kuro' && msg.id && msg.text) {
          const cleanedText = (msg.text as string).replace(/@\w+\s*/g, '').trim();
          const key = `${msg.from}\0${cleanedText.slice(0, 30).toLowerCase()}`;
          msgLookup.set(key, msg.id);
        }
      } catch { /* skip malformed lines */ }
    }
    // Transitively mark parents as addressed:
    // If Kuro replied to B, and B is a reply to A, A is also addressed (same thread context).
    for (const id of [...replied]) {
      let parent = parentOf.get(id);
      while (parent && !replied.has(parent)) {
        replied.add(parent);
        parent = parentOf.get(parent);
      }
    }
  } catch { /* fire-and-forget */ }
  return { replied, msgLookup };
}

/** Check if Kuro replied to a message in the room, by ID or content lookup. */
function isRepliedInRoom(
  msgId: string | undefined, sender: string, text: string,
  replied: Set<string>, msgLookup: Map<string, string>,
): boolean {
  // Direct ID match
  if (msgId && replied.has(msgId)) return true;
  // Transitive: if this message is a reply (↩parent) and Kuro replied to the parent
  const replyToHint = text.match(/↩(\d{4}-\d{2}-\d{2}-\d+)/);
  if (replyToHint && replied.has(replyToHint[1])) return true;
  // Fallback: look up message ID by sender + text prefix (for old entries without [msgId])
  // Strip leading ↩ replyTo hint and @mentions for matching
  const cleanText = text.replace(/^↩\S+\s*/, '').replace(/@\w+\s*/g, '').trim();
  const lookupKey = `${sender}\0${cleanText.slice(0, 30).toLowerCase()}`;
  const resolvedId = msgLookup.get(lookupKey);
  if (resolvedId && replied.has(resolvedId)) return true;
  return false;
}

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

/** Check if Kuro's response addressed a particular inbox message.
 * Stricter matching: check <kuro:chat> content (not full response), require multiple keyword hits.
 * Previous version was too lenient — any single keyword in the full OODA output would match. */
function isMessageAddressed(
  sender: string, messageText: string,
  response: string, chatTags: Array<{ text: string; reply: boolean }>, action: string | null,
): boolean {
  const senderLower = sender.toLowerCase();
  const terms = extractKeyTerms(messageText);
  const meaningfulTerms = terms.filter(t => t.length > 3); // skip short/common words

  // 1. Has <kuro:chat> tags → check CHAT content specifically (not full response)
  if (chatTags.length > 0) {
    const chatContent = chatTags.map(t => t.text).join(' ').toLowerCase();
    // Explicit sender mention in CHAT
    if (chatContent.includes(senderLower)) return true;
    // At least 2 meaningful keywords in CHAT content
    const chatMatches = meaningfulTerms.filter(t => chatContent.includes(t));
    if (chatMatches.length >= 2) return true;
  }

  // 2. Action explicitly mentions sender + at least 2 meaningful keywords
  if (action) {
    const actionLower = action.toLowerCase();
    if (actionLower.includes(senderLower)) {
      const actionMatches = meaningfulTerms.filter(t => actionLower.includes(t));
      if (actionMatches.length >= 2) return true;
    }
  }

  // 3. Very short message (≤2 words after removing @mention) + any <kuro:chat> → addressed
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

    // Read Kuro's room replies from conversation JSONL
    const { replied, msgLookup } = getRoomReplyStatus();

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
      // Parse: - [YYYY-MM-DD HH:MM] (sender) [msgId] text  OR  - [YYYY-MM-DD HH:MM] (sender) text
      const match = line.match(/^- \[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\] \((\w[\w-]*)\) (?:\[(\d{4}-\d{2}-\d{2}-\d+)\] )?(.+)$/);
      if (!match) {
        // Unparseable → move to processed as-is
        newProcessed.push(`${line} → processed ${nowStr}`);
        continue;
      }

      const [, ts, sender, msgId, text] = match;

      // Check 1: Kuro replied to this message in the room (via replyTo in JSONL)
      const repliedInRoom = isRepliedInRoom(msgId, sender, text, replied, msgLookup);
      // Check 2: Text-based matching (CHAT tags, ACTION keywords)
      const addressed = repliedInRoom || isMessageAddressed(sender, text, response, tags.chats, action);

      if (addressed) {
        const suffix = repliedInRoom ? 'replied' : (tags.chats.length > 0 ? 'replied' : 'addressed');
        newProcessed.push(`${line} → ${suffix} ${nowStr}`);
      } else {
        // Move to unaddressed with summary + unaddressed timestamp
        const summary = summarizeMessage(text);
        const idPart = msgId ? `[${msgId}] ` : '';
        newUnaddressed.push(`- [${ts}|u:${nowStr}] (${sender}) ${idPart}${summary}`);
      }
    }

    // Process existing unaddressed messages
    for (const line of unaddressedLines) {
      // Parse: - [ts|u:ts] (sender) [msgId] text  OR  - [ts|u:ts] (sender) text
      const match = line.match(/^- \[(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\|u:(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\] \((\w[\w-]*)\) (?:\[(\d{4}-\d{2}-\d{2}-\d+)\] )?(.+)$/);
      if (!match) {
        // Unparseable → expire
        newProcessed.push(`${line} → expired ${nowStr}`);
        continue;
      }

      const [, originalTs, _uTs, sender, msgId, text] = match;

      // Check 1: Kuro replied to this message in the room
      const repliedInRoom = isRepliedInRoom(msgId, sender, text, replied, msgLookup);
      // Check 2: Text-based matching
      if (repliedInRoom || isMessageAddressed(sender, text, response, tags.chats, action)) {
        const suffix = repliedInRoom ? 'replied' : (tags.chats.length > 0 ? 'replied' : 'addressed');
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
  // Exception: 'kuro:ask' threads — Alex may take days to reply to <kuro:ask> questions
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
 * 所有完成的工作都 auto-commit（Alex 指令 2026-02-26）。
 */
const ATOMIC_COMMIT_GROUPS: Array<{ paths: string[]; prefix: string }> = [
  { paths: ['memory/'], prefix: 'chore(auto)' },
  { paths: ['skills/'], prefix: 'chore(auto/skills)' },
  { paths: ['plugins/'], prefix: 'chore(auto/plugins)' },
  { paths: ['src/'], prefix: 'chore(auto/src)' },
  { paths: ['scripts/'], prefix: 'chore(auto/scripts)' },
  { paths: ['chat-room.html', 'dashboard.html', 'mobile.html'], prefix: 'chore(auto/ui)' },
  { paths: ['kuro-portfolio/'], prefix: 'chore(auto/portfolio)' },
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

}

// =============================================================================
// <kuro:done> Tag — 從 NEXT.md 移除已完成項目
// =============================================================================

/**
 * 將 NEXT.md 中匹配的項目標記為完成（移除 checkbox）。
 * 匹配邏輯：<kuro:done> 的描述包含 NEXT.md 項目的關鍵字即視為匹配。
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

        // 嘗試匹配：取 <kuro:done> 描述的前 30 字和每個 item 比對
        const doneNorm = done.toLowerCase().slice(0, 80);
        const matched = items.find(item => {
          const itemNorm = item.toLowerCase();
          // 精確匹配 timestamp（如果 <kuro:done> 包含 timestamp）
          const tsMatch = doneNorm.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
          if (tsMatch && itemNorm.includes(tsMatch[0])) return true;
          // 模糊匹配：Alex 訊息前 20 字
          const previewMatch = itemNorm.match(/回覆 Alex: "(.{10,30})"/);
          if (previewMatch && doneNorm.includes(previewMatch[1].toLowerCase().slice(0, 15))) return true;
          // 最寬鬆：只要 <kuro:done> 提到 "alex" 且 item 是 "回覆 Alex"
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
