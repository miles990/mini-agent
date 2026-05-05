/**
 * Actor Outcome Stats.
 *
 * Converts brain-run events into small, bounded historical feedback for actor
 * selection. This is deliberately descriptive: policy decides how much to trust
 * it.
 */

import type { ActorId, WorkIntent } from './brain-types.js';
import { readBrainRunEventsSync } from './brain-run-ledger.js';

export interface ActorOutcomeStat {
  actor: ActorId;
  intent?: WorkIntent;
  total: number;
  success: number;
  failed: number;
  skipped: number;
  successRate: number;
  avgDurationMs: number | null;
  confidence: number;
  lastFinishedAt: string | null;
}

export interface ActorOutcomeStatsOptions {
  intent?: WorkIntent;
  limit?: number;
}

export type ActorOutcomeStats = Partial<Record<ActorId, ActorOutcomeStat>>;

export function readActorOutcomeStatsSync(
  memoryDir: string,
  opts: ActorOutcomeStatsOptions = {},
): ActorOutcomeStats {
  const events = readBrainRunEventsSync(memoryDir, {
    event: 'actor_finished',
    limit: opts.limit ?? 500,
  }).filter(event => event.actor && (!opts.intent || event.intent === opts.intent));

  const grouped = new Map<ActorId, Array<typeof events[number]>>();
  for (const event of events) {
    if (!event.actor) continue;
    grouped.set(event.actor, [...(grouped.get(event.actor) ?? []), event]);
  }

  const stats: ActorOutcomeStats = {};
  for (const [actor, actorEvents] of grouped) {
    const success = actorEvents.filter(event => event.status === 'success').length;
    const failed = actorEvents.filter(event => event.status === 'failed').length;
    const skipped = actorEvents.filter(event => event.status === 'skipped').length;
    const durations = actorEvents
      .map(event => event.durationMs)
      .filter((duration): duration is number => typeof duration === 'number');
    const total = actorEvents.length;
    stats[actor] = {
      actor,
      ...(opts.intent ? { intent: opts.intent } : {}),
      total,
      success,
      failed,
      skipped,
      successRate: total > 0 ? success / total : 0,
      avgDurationMs: durations.length > 0
        ? Math.round(durations.reduce((sum, duration) => sum + duration, 0) / durations.length)
        : null,
      confidence: Math.min(1, total / 10),
      lastFinishedAt: actorEvents[0]?.createdAt ?? null,
    };
  }

  return stats;
}
