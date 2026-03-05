/**
 * Model Router — 智能模型選擇
 *
 * 根據 cycle 特徵決定使用 Opus 還是 Sonnet。
 * 核心原則：品質敏感的任務用 Opus，常規任務用 Sonnet 省 token。
 *
 * Opus: 直接對話、創作、複雜決策、任務執行
 * Sonnet: 常規感知處理、學習筆記、心跳 cycle
 *
 * Feature toggle: `sonnet-routing`（reserved + autonomous 預設開啟）
 */

import { slog } from './utils.js';
import { isEnabled } from './features.js';
import type { CycleMode } from './memory.js';

// =============================================================================
// Types
// =============================================================================

export type ModelTier = 'opus' | 'sonnet';

export interface RouteInput {
  triggerReason: string | null;
  cycleMode: CycleMode;
  hasDirectMessage: boolean;
  hasInbox: boolean;
}

export interface RouteResult {
  model: ModelTier;
  reason: string;
}

// =============================================================================
// Routing Logic
// =============================================================================

/** Direct message sources — always Opus */
const DIRECT_MESSAGE_TRIGGERS = ['telegram-user', 'room', 'chat', 'direct-message'];

/**
 * Route a cycle to the appropriate model tier.
 *
 * Decision tree (ordered by priority):
 * 1. Feature disabled → Opus (fallback)
 * 2. Direct message trigger → Opus
 * 3. Alert trigger → Opus
 * 4. Inbox items present → Opus
 * 5. respond/act/task/reflect mode → Opus
 * 6. learn mode + routine trigger → Sonnet
 * 7. Default → Opus (safety)
 */
export function routeModel(input: RouteInput): RouteResult {
  // Gate: feature toggle
  if (!isEnabled('sonnet-routing')) {
    return { model: 'opus', reason: 'feature-disabled' };
  }

  // Rule 1: Direct messages always Opus
  if (input.hasDirectMessage || DIRECT_MESSAGE_TRIGGERS.some(t => input.triggerReason?.startsWith(t))) {
    return { model: 'opus', reason: 'direct-message' };
  }

  // Rule 2: Alert triggers always Opus
  if (input.triggerReason?.startsWith('alert')) {
    return { model: 'opus', reason: 'alert' };
  }

  // Rule 3: Inbox items → Opus (someone's waiting)
  if (input.hasInbox) {
    return { model: 'opus', reason: 'inbox-pending' };
  }

  // Rule 4: Execution-sensitive modes → Opus
  if (input.cycleMode === 'respond' || input.cycleMode === 'act' || input.cycleMode === 'task' || input.cycleMode === 'reflect') {
    return { model: 'opus', reason: `${input.cycleMode}-mode` };
  }

  // Rule 5: learn mode + routine trigger → Sonnet
  if (input.cycleMode === 'learn') {
    const routineTrigger = !input.triggerReason
      || input.triggerReason === 'heartbeat'
      || input.triggerReason === 'workspace'
      || input.triggerReason === 'schedule';
    if (routineTrigger) {
      return { model: 'sonnet', reason: 'routine-learn' };
    }
  }

  // Default: Opus (safety)
  return { model: 'opus', reason: 'default' };
}

// =============================================================================
// Outcome Tracking — 追蹤模型選擇的品質結果
// =============================================================================

interface ModelOutcome {
  model: ModelTier;
  cycleMode: string;
  triggerReason: string;
  observabilityScore: number;
  durationMs: number;
  timestamp: string;
}

const recentOutcomes: ModelOutcome[] = [];
const MAX_OUTCOMES = 100;

/** Record cycle outcome for model quality tracking */
export function recordModelOutcome(outcome: ModelOutcome): void {
  recentOutcomes.push(outcome);
  if (recentOutcomes.length > MAX_OUTCOMES) {
    recentOutcomes.shift();
  }
}

/** Get model usage stats for observability */
export function getModelStats(): {
  opus: { count: number; avgScore: number; avgDurationMs: number };
  sonnet: { count: number; avgScore: number; avgDurationMs: number };
} {
  const opus = recentOutcomes.filter(o => o.model === 'opus');
  const sonnet = recentOutcomes.filter(o => o.model === 'sonnet');

  const avg = (arr: ModelOutcome[], key: 'observabilityScore' | 'durationMs') =>
    arr.length ? Math.round(arr.reduce((s, o) => s + o[key], 0) / arr.length * 100) / 100 : 0;

  return {
    opus: { count: opus.length, avgScore: avg(opus, 'observabilityScore'), avgDurationMs: avg(opus, 'durationMs') },
    sonnet: { count: sonnet.length, avgScore: avg(sonnet, 'observabilityScore'), avgDurationMs: avg(sonnet, 'durationMs') },
  };
}

/** Get CLI model name for the tier */
export function getModelCliName(tier: ModelTier): string | undefined {
  // undefined = use subscription default (Opus)
  if (tier === 'opus') return undefined;
  return 'sonnet';
}
