/**
 * mushi client — HTTP communication with the mushi System 1 service.
 * Extracted from loop.ts (5th modularization cut).
 */

import { slog } from './utils.js';
import { eventBus } from './event-bus.js';

export const MUSHI_BASE_URL = 'http://localhost:3000';
export const MUSHI_TRIAGE_URL = `${MUSHI_BASE_URL}/api/triage`;
export const MUSHI_CONTINUATION_URL = `${MUSHI_BASE_URL}/api/continuation-check`;
export const MUSHI_DEDUP_URL = `${MUSHI_BASE_URL}/api/dedup`;
export const MUSHI_ROUTE_URL = `${MUSHI_BASE_URL}/api/route`;
export const MUSHI_HEALTH_URL = `${MUSHI_BASE_URL}/health`;

// ── Triage ──────────────────────────────────────────────────────────────────

export interface TriageContext {
  lastCycleTime: number;
  lastAction: string | null;
  lastPerceptionVersion: number;
  currentPerceptionVersion: number;
  perceptionChangedCount: number;
  cycleCount: number;
}

/** Ask mushi to classify a trigger as wake/skip/quick. Returns decision or null (offline/error = fail-open). */
export async function mushiTriage(
  source: string,
  data: Record<string, unknown>,
  ctx: TriageContext,
  messageText?: string,
): Promise<'wake' | 'skip' | 'quick' | null> {
  try {
    const metadata: Record<string, unknown> = {};
    if (ctx.lastCycleTime > 0) {
      metadata.lastThinkAgo = Math.round((Date.now() - ctx.lastCycleTime) / 1000);
    }
    if (data.source === 'auto-commit' || String(data.detail ?? '').includes('auto-commit')) {
      metadata.isAutoCommit = true;
    }
    // Last action type: helps mushi distinguish "just idled" vs "just acted"
    if (ctx.lastAction) {
      const idle = /no action|穩態|無需行動|nothing to do/i.test(ctx.lastAction);
      metadata.lastActionType = idle ? 'idle' : 'action';
    } else {
      metadata.lastActionType = 'none';
    }
    metadata.perceptionChanged = ctx.currentPerceptionVersion !== ctx.lastPerceptionVersion;
    metadata.perceptionChangedCount = ctx.perceptionChangedCount;
    metadata.cycleCount = ctx.cycleCount;
    // Pass message text for DM classification
    if (messageText) {
      metadata.messageText = messageText;
    }

    const res = await fetch(MUSHI_TRIAGE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trigger: source,
        source: String(data.source ?? source),
        metadata,
      }),
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) return null;
    const result = await res.json() as { action?: string; reason?: string; latencyMs?: number; method?: string };

    const emoji = result.action === 'skip' ? '⏭' : result.action === 'quick' ? '⚡' : '✅';
    slog('MUSHI', `${emoji} triage: ${source} → ${result.action} (${result.latencyMs}ms ${result.method}) — ${result.reason}`);
    eventBus.emit('log:info', { tag: 'mushi-triage', msg: `${source} → ${result.action} (${result.latencyMs}ms ${result.method})`, source, action: result.action, latencyMs: result.latencyMs, method: result.method });
    const validActions = ['skip', 'wake', 'quick'];
    return validActions.includes(result.action ?? '') ? result.action as 'wake' | 'skip' | 'quick' : null;
  } catch {
    // mushi offline or timeout — fail-open (proceed with cycle)
    return null;
  }
}

// ── Continuation Check ──────────────────────────────────────────────────────

export interface ContinuationContext {
  lastAction: string | null;
  triggerReason: string | null;
}

/**
 * Ask mushi whether to continue immediately after a cycle.
 * Fail-closed: mushi offline or error → no continuation (normal heartbeat).
 */
export async function mushiContinuationCheck(ctx: ContinuationContext): Promise<{ shouldContinue: boolean; deep: boolean } | null> {
  try {
    const { readPendingInbox } = await import('./inbox.js');
    const hasUnprocessedInbox = readPendingInbox().length > 0;

    const res = await fetch(MUSHI_CONTINUATION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        hasUnprocessedInbox,
        lastActionSummary: ctx.lastAction ?? 'no action',
        inProgressWork: ctx.triggerReason ?? undefined,
        source: ctx.triggerReason?.split(/[:(]/)[0]?.trim() ?? undefined,
      }),
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) return null;
    const result = await res.json() as {
      ok?: boolean; shouldContinue?: boolean; deep?: boolean;
      reason?: string; latencyMs?: number; method?: string;
    };

    slog('MUSHI', `🔄 continuation: ${result.shouldContinue ? 'YES' : 'no'} (${result.latencyMs}ms ${result.method}) — ${result.reason}`);
    return { shouldContinue: !!result.shouldContinue, deep: !!result.deep };
  } catch {
    return null; // Fail-closed
  }
}
