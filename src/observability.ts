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
import { notify } from './telegram.js';

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
  const logger = getLogger();
  const text = e.data.text as string;
  notify(`💬 Kuro 想跟你聊聊：\n\n${text}`, 'signal');
  slog('LOOP', `💬 Chat to Alex: ${text.slice(0, 80)}`);
  logger.logBehavior('agent', 'telegram.chat', text.slice(0, 200));

  // Bridge to Chat Room — fire-and-forget (no replyTo for Kuro's direct chats)
  writeRoomMessage('kuro', text).catch(() => {});
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

export async function writeRoomMessage(from: string, text: string, replyTo?: string): Promise<string> {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);

  const convDir = path.join(process.cwd(), 'memory', 'conversations');
  if (!fs.existsSync(convDir)) {
    await fsPromises.mkdir(convDir, { recursive: true });
  }

  // Generate date-based ID: YYYY-MM-DD-NNN
  const convPath = path.join(convDir, `${dateStr}.jsonl`);
  let lineCount = 0;
  try {
    const raw = await fsPromises.readFile(convPath, 'utf-8');
    lineCount = raw.split('\n').filter(Boolean).length;
  } catch { /* file doesn't exist yet */ }
  const id = `${dateStr}-${String(lineCount + 1).padStart(3, '0')}`;

  // Parse mentions
  const mentions: string[] = [];
  if (text.includes('@kuro')) mentions.push('kuro');
  if (text.includes('@claude')) mentions.push('claude-code');
  if (text.includes('@alex')) mentions.push('alex');

  const entry: Record<string, unknown> = { id, from, text, ts: now.toISOString(), mentions };
  if (replyTo) entry.replyTo = replyTo;

  await fsPromises.appendFile(convPath, JSON.stringify(entry) + '\n');

  eventBus.emit('action:room', { id, from, text, ts: now.toISOString(), mentions, ...(replyTo ? { replyTo } : {}) });

  return id;
}
