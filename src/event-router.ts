/**
 * Event Router — L2 路由層（可插拔，預設確定性規則）
 *
 * 核心不變量：事件只能被延遲，不能被消滅。
 * Router 可讀 content 做 priority classification，但不能基於 content 語義 drop 事件。
 *
 * 三方共識（Alex + Claude Code + Kuro, Chat Room 2026-02-24 #032-#066）
 */

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { getInstanceDir, getCurrentInstanceId } from './instance.js';

// =============================================================================
// Types
// =============================================================================

export enum Priority {
  P0 = 0,  // Alex Telegram DM — 最高，可搶佔
  P1 = 1,  // Chat Room @kuro question, GitHub mention — 高，cooperative yield
  P2 = 2,  // Workspace changes, cron tasks — 正常，排隊
  P3 = 3,  // Heartbeat, idle check — 低，可延遲
}

export type EventSource =
  | 'telegram' | 'room' | 'workspace' | 'cron'
  | 'github' | 'mobile' | 'heartbeat' | 'chat' | 'alert';

export interface UnifiedEvent {
  id: string;
  source: EventSource;
  priority: Priority;
  content: string | null;
  metadata: Record<string, unknown>;
  ts: Date;
}

/**
 * 路由決策 — 型別系統強制無 skip/drop。
 * 事件只能被延遲（lane 調整），不能被消滅。
 */
export interface RouteDecision {
  priority: Priority;
  lane: 'preempt' | 'immediate' | 'normal' | 'deferred';
  reason: string;
  priorityAdjusted?: {
    from: Priority;
    to: Priority;
    basis: string;
  };
}

/**
 * 路由器介面 — 任何實作都必須符合。
 * route() 可讀 event.content 做 priority classification，
 * 但 'deferred' lane 只允許基於結構/時間規則（cooldown、unchanged perception）。
 * 不變量：事件只能被延遲，不能被消滅。
 */
export interface EventRouter {
  route(event: UnifiedEvent, loopState: LoopState): RouteDecision;
  readonly name: string;
  readonly costPerCall: number;
}

export interface LoopState {
  cycling: boolean;
  lastCycleTime: number;
  triggerReason: string | null;
  currentMode: string;
  perceptionChanged: boolean;
}

/** Priority SLA — 每個等級的處理時限（cycles） */
export const PRIORITY_SLA: Record<Priority, number> = {
  [Priority.P0]: 0,
  [Priority.P1]: 1,
  [Priority.P2]: 3,
  [Priority.P3]: 10,
};

// =============================================================================
// Deterministic Router (Phase 1)
// =============================================================================

const COOLDOWN_MS = 10_000;
const recentEvents = new Map<string, number>();

const STALE_THRESHOLD = 20;
const unchangedCounts = new Map<string, number>();

export class DeterministicRouter implements EventRouter {
  readonly name = 'deterministic';
  readonly costPerCall = 0;

  route(event: UnifiedEvent, loopState: LoopState): RouteDecision {
    // Rule 1: P0 事件 — 搶佔
    if (event.priority === Priority.P0 && loopState.cycling) {
      return { priority: Priority.P0, lane: 'preempt', reason: 'P0 event during cycle' };
    }

    // Rule 2: P1 事件 — cooperative yield
    if (event.priority === Priority.P1 && loopState.cycling) {
      return { priority: Priority.P1, lane: 'immediate', reason: 'P1 queued for next cycle' };
    }

    // Rule 3: P3 — 感知無變化 → deferred
    if (event.priority === Priority.P3 && !loopState.perceptionChanged) {
      // Rule 3b: Staleness guard — unchanged 太久 → force normal
      const count = (unchangedCounts.get(event.source) ?? 0) + 1;
      unchangedCounts.set(event.source, count);
      if (count > STALE_THRESHOLD) {
        unchangedCounts.set(event.source, 0);
        return { priority: Priority.P3, lane: 'normal', reason: 'stale-check: unchanged too long' };
      }
      return { priority: Priority.P3, lane: 'deferred', reason: 'no perception changes' };
    } else if (event.priority === Priority.P3) {
      unchangedCounts.set(event.source, 0);
    }

    // Rule 4: 冷卻期 — 同 source 10s 內不重複觸發（P0/P1 永遠跳過：direct messages 不可被 cooldown 擋）
    if (event.priority >= Priority.P2) {
      const lastSeen = recentEvents.get(event.source);
      const now = event.ts.getTime();
      if (lastSeen && (now - lastSeen) < COOLDOWN_MS) {
        return { priority: event.priority, lane: 'deferred', reason: 'cooldown' };
      }
      recentEvents.set(event.source, now);
    }

    // Default
    return { priority: event.priority, lane: 'normal', reason: 'normal processing' };
  }
}

// =============================================================================
// Event Factory
// =============================================================================

let eventCounter = 0;

export function createEvent(
  source: EventSource,
  priority: Priority,
  content: string | null = null,
  metadata: Record<string, unknown> = {},
): UnifiedEvent {
  const now = new Date();
  const id = `${now.toISOString().slice(0, 10)}-E${String(++eventCounter).padStart(4, '0')}`;
  return { id, source, priority, content, metadata, ts: now };
}

/** Map trigger event type → EventSource + Priority */
export function classifyTrigger(
  eventType: string,
  data: Record<string, unknown>,
): { source: EventSource; priority: Priority } {
  switch (eventType) {
    case 'trigger:telegram-user':
      return { source: 'telegram', priority: Priority.P0 };
    case 'trigger:room': {
      const text = (data?.text as string) ?? '';
      const isQuestion = text.includes('@kuro') && (text.includes('?') || text.includes('？'));
      return { source: 'room', priority: isQuestion ? Priority.P1 : Priority.P2 };
    }
    case 'trigger:workspace':
      return { source: 'workspace', priority: Priority.P2 };
    case 'trigger:cron':
      return { source: 'cron', priority: Priority.P2 };
    case 'trigger:chat':
      return { source: 'chat', priority: Priority.P1 };
    case 'trigger:alert':
      return { source: 'alert', priority: Priority.P1 };
    case 'trigger:mobile':
      return { source: 'mobile', priority: Priority.P3 };
    case 'trigger:heartbeat':
      return { source: 'heartbeat', priority: Priority.P3 };
    case 'trigger:telegram':
      return { source: 'telegram', priority: Priority.P2 };
    default:
      return { source: 'heartbeat', priority: Priority.P3 };
  }
}

// =============================================================================
// Audit Trail
// =============================================================================

export function logRoute(event: UnifiedEvent, decision: RouteDecision): void {
  try {
    const dir = getInstanceDir(getCurrentInstanceId());
    const logPath = path.join(dir, 'route-log.jsonl');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const entry = JSON.stringify({
      eventId: event.id,
      source: event.source,
      originalPriority: event.priority,
      priority: decision.priority,
      lane: decision.lane,
      ...(decision.priorityAdjusted ? { adjusted: decision.priorityAdjusted } : {}),
      reason: decision.reason,
      ts: new Date().toISOString(),
    });
    appendFileSync(logPath, entry + '\n');
  } catch { /* best effort */ }
}

// =============================================================================
// Singleton
// =============================================================================

export const router: EventRouter = new DeterministicRouter();
