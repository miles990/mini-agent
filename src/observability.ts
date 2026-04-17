/**
 * Observability Subscribers — 統一事件 → slog/logBehavior/notify 路由
 *
 * Phase 3a: loop.ts 和 dispatcher.ts 的 slog/logBehavior/notify 呼叫
 * 改為 eventBus.emit()，由此模組的 subscribers 負責實際輸出。
 * 輸出格式與重構前完全一致。
 */

import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { eventBus } from './event-bus.js';
import type { AgentEvent } from './event-bus.js';
import { slog } from './utils.js';
import { getLogger } from './logging.js';
import { notify, notifyTelegram, getLastAlexMessageId } from './telegram.js';
import { recordReply } from './reply-context.js';
import type { MessageContext } from './preprocessor.js';

// =============================================================================
// sendChat — 統一的 chat 發送閘門（dedup + Telegram + Room + record）
// =============================================================================

const recentlySentChats = new Map<string, number>();

/**
 * 統一 chat 發送口。所有 chat→Telegram 路徑都經過這裡，內建 60s 去重。
 * @returns true if sent, false if deduplicated
 */
export function sendChat(text: string, opts?: {
  reply?: boolean;
  telegramMsgId?: number;
  roomReplyTo?: string;
  /** true = DM 回覆（不加 💬 prefix），false/undefined = 主動聊天 */
  directReply?: boolean;
}): boolean {
  const key = text.trim().replace(/\s+/g, ' ');
  const now = Date.now();
  const prev = recentlySentChats.get(key);
  if (prev && now - prev < 60_000) {
    slog('DEDUP', `Chat skipped (duplicate within 60s): ${text.slice(0, 60)}`);
    return false;
  }
  recentlySentChats.set(key, now);
  // Prune stale entries
  if (recentlySentChats.size > 50) {
    for (const [k, t] of recentlySentChats) {
      if (now - t > 120_000) recentlySentChats.delete(k);
    }
  }

  const replyToMsgId = opts?.reply
    ? (opts.telegramMsgId ?? getLastAlexMessageId() ?? undefined)
    : undefined;
  const tgText = opts?.directReply ? text : `💬 Kuro 想跟你聊聊：\n\n${text}`;
  notifyTelegram(tgText, replyToMsgId).catch(err => {
    slog('LOOP', `Telegram chat failed: ${err instanceof Error ? err.message : err}`);
  });
  recordReply(text);
  writeRoomMessage('kuro', text, opts?.roomReplyTo).catch(() => {});
  slog('LOOP', `💬 Chat to Alex: ${text.slice(0, 80)}${replyToMsgId ? ` (reply_to:${replyToMsgId})` : ''}`);
  getLogger().logBehavior('agent', 'telegram.chat', text.slice(0, 200));
  return true;
}

// =============================================================================
// Init — 註冊所有 subscribers
// =============================================================================

export function initObservability(): void {
  eventBus.on('action:loop', handleLoopEvent);
  eventBus.on('action:memory', handleMemoryEvent);
  eventBus.on('action:task', handleTaskEvent);
  eventBus.on('action:chat', handleChatEvent);
  eventBus.on('action:show', handleShowEvent);
  eventBus.on('action:summary', handleSummaryEvent);
  eventBus.on('action:handoff', handleHandoffEvent);
  eventBus.on('action:room', handleRoomEvent);
  eventBus.on('log:info', handleLogInfo);
  eventBus.on('security:threat', handleSecurityThreat);
}

function handleSecurityThreat(e: AgentEvent): void {
  const d = e.data;
  slog('SECURITY', `⚠️ Threat detected: ${d.patternId} [${d.severity}] trust=${d.trust} — ${(d.reason as string)?.slice(0, 120)}`);
  getLogger().logBehavior('system', 'security.threat', JSON.stringify({
    patternId: d.patternId, severity: d.severity, trust: d.trust,
    preview: (d.contentPreview as string)?.slice(0, 50),
  }));
}

// =============================================================================
// action:loop — Loop 生命週期 + 行為
// =============================================================================

function handleLoopEvent(e: AgentEvent): void {
  const d = e.data;
  const logger = getLogger();
  const cc = d.cycleCount as number | undefined;
  const act = d.action as string | undefined;
  const dur = d.duration as number | undefined;

  switch (d.event) {
    case 'start':
      slog('LOOP', d.detail as string);
      notify('🟢 Kuro 上線了', 'signal');
      break;

    case 'stop':
      slog('LOOP', 'Stopped');
      break;

    case 'cycle.start':
      logger.logBehavior('agent', 'loop.cycle.start', `#${cc}`);
      break;

    case 'cycle.skip':
      slog('LOOP', `#${cc} ♻️ context unchanged, skip`);
      logger.logBehavior('agent', 'loop.cycle.end', `#${cc} context unchanged`);
      break;

    case 'cooldown':
      slog('LOOP', `#${cc} 💤 cooldown (${d.remaining} remaining)`);
      break;

    case 'outside-hours':
      slog('LOOP', `#${cc} 🌙 outside active hours`);
      break;

    case 'mode':
      slog('LOOP', `#${cc} 🎯 Mode: ${(d.mode as string).toUpperCase()}${d.triggerInfo || ''}`);
      break;

    case 'action.autonomous':
      notify(`🧠 ${act}`, 'heartbeat');
      slog('LOOP', `#${cc} 🧠 ${act!.slice(0, 100)} (${(dur! / 1000).toFixed(1)}s)`);
      logger.logBehavior('agent', 'action.autonomous', act!.slice(0, 2000));
      break;

    case 'action.task':
      notify(`⚡ ${act}`, 'heartbeat');
      slog('LOOP', `#${cc} ⚡ ${act!.slice(0, 100)} (${(dur! / 1000).toFixed(1)}s)`);
      logger.logBehavior('agent', 'action.task', act!.slice(0, 2000));
      break;

    case 'idle':
      slog('LOOP', `#${cc} 💤 no action (${(dur! / 1000).toFixed(1)}s), next heartbeat in ${d.nextHeartbeat}s`);
      break;

    case 'cycle.end':
      logger.logBehavior('agent', 'loop.cycle.end', `#${cc} ${d.decision}`);
      break;

    case 'metrics': {
      const detail = `#${cc} ratio=${d.autonomousTaskRatio} remember=${d.rememberCount} repeat=${d.similarityRate} (A:${d.autonomousCycles} T:${d.taskCycles})`;
      logger.logBehavior('agent', 'loop.metrics', detail);
      break;
    }
  }
}

// =============================================================================
// action:memory — 記憶保存
// =============================================================================

function handleMemoryEvent(e: AgentEvent): void {
  const logger = getLogger();
  const d = e.data;
  if (d.topic) {
    logger.logBehavior('agent', 'memory.save.topic', `#${d.topic}: ${(d.content as string).slice(0, 180)}`);
  } else {
    logger.logBehavior('agent', 'memory.save', (d.content as string).slice(0, 200));
  }
}

// =============================================================================
// action:task — 任務建立
// =============================================================================

function handleTaskEvent(e: AgentEvent): void {
  const logger = getLogger();
  slog('LOOP', `📋 Auto-created task: ${(e.data.content as string).slice(0, 80)}`);
  logger.logBehavior('agent', 'task.create', (e.data.content as string).slice(0, 200));
}

// =============================================================================
// action:chat — 主動聊天
// =============================================================================

function handleChatEvent(e: AgentEvent): void {
  sendChat(e.data.text as string, {
    reply: e.data.reply as boolean | undefined,
    telegramMsgId: e.data.telegramMsgId as number | undefined,
    roomReplyTo: e.data.roomReplyTo as string | undefined,
  });
}

// =============================================================================
// action:show — 展示網頁
// =============================================================================

function handleShowEvent(e: AgentEvent): void {
  const logger = getLogger();
  const { desc, url } = e.data as { desc: string; url: string };
  const urlPart = url ? `\n🔗 ${url}` : '';
  notify(`🌐 ${desc}${urlPart}`, 'signal');
  slog('LOOP', `🌐 Show: ${desc.slice(0, 60)} ${url}`);
  logger.logBehavior('agent', 'show.webpage', `${desc.slice(0, 100)}${url ? ` | ${url}` : ''}`);
}

// =============================================================================
// action:summary — 協作摘要
// =============================================================================

function handleSummaryEvent(e: AgentEvent): void {
  const logger = getLogger();
  const text = e.data.text as string;
  notify(`🤝 ${text}`, 'summary');
  slog('LOOP', `🤝 Summary: ${text.slice(0, 80)}`);
  logger.logBehavior('agent', 'collab.summary', text.slice(0, 200));
}

// =============================================================================
// action:handoff — Handoff 建立
// =============================================================================

function handleHandoffEvent(e: AgentEvent): void {
  const d = e.data;
  slog('HANDOFF', `Created: ${d.file} (from approved proposal)`);
  notify(`📋 Handoff 已建立：${d.title}\n等待 Claude Code 執行`, 'summary');
}

// =============================================================================
// log:info — 通用 slog 轉發
// =============================================================================

// =============================================================================
// action:room — Chat Room 訊息
// =============================================================================

function handleRoomEvent(e: AgentEvent): void {
  const logger = getLogger();
  const { from, text } = e.data as { from: string; text: string };
  const actor: 'user' | 'agent' | 'system' = from === 'kuro' ? 'agent' : from === 'alex' ? 'user' : 'system';
  logger.logBehavior(actor, 'room.message', `[${from}] ${(text as string).slice(0, 200)}`);
}

// =============================================================================
// log:info — 通用 slog 轉發
// =============================================================================

function handleLogInfo(e: AgentEvent): void {
  slog(e.data.tag as string, e.data.msg as string);
}

// =============================================================================
// writeRoomMessage — fire-and-forget 寫入 conversation JSONL + emit action:room
// =============================================================================

// In-memory counter to prevent duplicate IDs when multiple lanes write concurrently
let roomMsgCounterDate = '';
let roomMsgCounter = 0;

// Track replyTo targets kuro has already replied to — prevents duplicate threading
// First reply goes through threaded, subsequent replies become standalone messages
const kuroRepliedTo = new Map<string, number>();

// Content-level dedup: final gate for all writeRoomMessage call sites.
// Multiple upstream paths (stream, post-process, dispatcher, fallback, FG lane) can
// legitimately arrive here with the same (from, text) — drop duplicates within a 60s window.
// Convergence condition: "same kuro message content within 60s appears in room at most once",
// independent of how many upstream emitters misfired.
const recentRoomMsgs = new Map<string, number>();
const ROOM_DEDUP_WINDOW_MS = 60_000;

export async function writeRoomMessage(from: string, text: string, replyTo?: string, context?: MessageContext): Promise<string> {
  // Guard: don't write empty messages — they pollute JSONL and cause false "replied" signals
  if (!text || !text.trim()) {
    slog('ROOM', `Skipped empty message from ${from}${replyTo ? ` (replyTo: ${replyTo})` : ''}`);
    return '';
  }

  // Content-level dedup (final gate — all write paths funnel here)
  const nowMs = Date.now();
  const dedupKey = `${from}:${text.slice(0, 500)}`;
  const prevTs = recentRoomMsgs.get(dedupKey);
  if (prevTs !== undefined && nowMs - prevTs < ROOM_DEDUP_WINDOW_MS) {
    slog('DEDUP', `Dropped duplicate ${from} room message (${Math.round((nowMs - prevTs) / 1000)}s ago): ${text.slice(0, 80)}`);
    return '';
  }
  recentRoomMsgs.set(dedupKey, nowMs);
  if (recentRoomMsgs.size > 200) {
    for (const [k, ts] of recentRoomMsgs) {
      if (nowMs - ts > ROOM_DEDUP_WINDOW_MS) recentRoomMsgs.delete(k);
    }
  }

  // Dedup: if kuro already replied to this replyTo target, drop threading
  if (from === 'kuro' && replyTo) {
    if (kuroRepliedTo.has(replyTo)) {
      slog('DEDUP', `Dropping replyTo ${replyTo} — kuro already replied`);
      replyTo = undefined;
    } else {
      kuroRepliedTo.set(replyTo, Date.now());
      // Cleanup entries older than 1 hour
      for (const [k, ts] of kuroRepliedTo) {
        if (Date.now() - ts > 3600_000) kuroRepliedTo.delete(k);
      }
    }
  }

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);

  const convDir = path.join(process.cwd(), 'memory', 'conversations');
  if (!fs.existsSync(convDir)) {
    await fsPromises.mkdir(convDir, { recursive: true });
  }

  // Generate date-based ID: YYYY-MM-DD-NNN (atomic in-memory counter)
  const convPath = path.join(convDir, `${dateStr}.jsonl`);
  if (roomMsgCounterDate !== dateStr) {
    // New day or first call — sync from file
    roomMsgCounterDate = dateStr;
    try {
      const raw = await fsPromises.readFile(convPath, 'utf-8');
      roomMsgCounter = raw.split('\n').filter(Boolean).length;
    } catch { roomMsgCounter = 0; }
  }
  roomMsgCounter++;
  const id = `${dateStr}-${String(roomMsgCounter).padStart(3, '0')}`;

  // Parse mentions
  const mentions: string[] = [];
  if (text.includes('@kuro')) mentions.push('kuro');
  if (text.includes('@claude')) mentions.push('claude-code');
  if (text.includes('@alex')) mentions.push('alex');

  const entry: Record<string, unknown> = { id, from, text, ts: now.toISOString(), mentions };
  if (replyTo) entry.replyTo = replyTo;
  if (context) {
    // Fix task origins with real ID (preprocessor used temp ID)
    for (const t of context.tasks) t.origin = `room:${id}`;
    entry.context = context;
  }

  await fsPromises.appendFile(convPath, JSON.stringify(entry) + '\n');

  eventBus.emit('action:room', { id, from, text, ts: now.toISOString(), mentions, ...(replyTo ? { replyTo } : {}) });

  return id;
}
