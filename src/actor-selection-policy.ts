/**
 * Actor selection scoring.
 *
 * This layer turns the actor registry into an explainable preference order.
 * It does not decide hard safety constraints; Constraint Texture still owns
 * human gates, write leases, and claim requirements.
 */

import type { ActorId, WorkIntent, WorkItem, WorkRisk } from './brain-types.js';
import { getActorProfile, type ActorProfile, type ActorRoleTendency } from './actor-registry.js';
import type { ActorOutcomeStats } from './actor-outcome-stats.js';

export type SelectionRole = 'primary' | 'reviewer' | 'advisor' | 'executor';

export interface ActorScore {
  actor: ActorId;
  role: SelectionRole;
  score: number;
  reasons: string[];
}

export interface SelectionOptions {
  availableActors?: ActorId[];
  actorStats?: ActorOutcomeStats;
}

const DEFAULT_AVAILABLE: ActorId[] = ['claude', 'codex', 'local', 'shell', 'akari', 'human'];

const INTENT_CAPABILITY_HINTS: Record<WorkIntent, string[]> = {
  chat: ['low-cost-reasoning', 'writing'],
  plan: ['reasoning', 'strategy', 'architecture'],
  code: ['code', 'repo-edit', 'tests'],
  research: ['research', 'long-context', 'reasoning'],
  summarize: ['cheap-summary', 'long-context', 'writing'],
  json: ['classification', 'cheap-summary'],
  diagnose: ['debug', 'tests', 'shell-guided-verification'],
  review: ['review', 'critique'],
  verify: ['deterministic-verification', 'run-command', 'health-check'],
  architecture: ['architecture', 'strategy', 'critique'],
  memory: ['memory-owner', 'shared-context', 'reflection'],
  policy: ['policy', 'strategy', 'critique'],
};

export function rankActorsForRole(
  item: WorkItem,
  role: SelectionRole,
  opts: SelectionOptions = {},
): ActorScore[] {
  const available = opts.availableActors ?? DEFAULT_AVAILABLE;
  return available
    .map(actor => scoreActor(item, actor, role, opts))
    .filter((score): score is ActorScore => score !== null)
    .sort((a, b) => b.score - a.score || a.actor.localeCompare(b.actor));
}

export function pickActorForRole(
  item: WorkItem,
  role: SelectionRole,
  opts: SelectionOptions = {},
): ActorId {
  return rankActorsForRole(item, role, opts)[0]?.actor ?? 'kuro';
}

export function pickActorsForRole(
  item: WorkItem,
  role: SelectionRole,
  opts: SelectionOptions & { limit?: number; exclude?: ActorId[] } = {},
): ActorId[] {
  const excluded = new Set(opts.exclude ?? []);
  return rankActorsForRole(item, role, opts)
    .filter(score => !excluded.has(score.actor))
    .slice(0, opts.limit ?? 1)
    .map(score => score.actor);
}

function scoreActor(
  item: WorkItem,
  actor: ActorId,
  role: SelectionRole,
  opts: SelectionOptions,
): ActorScore | null {
  const profile = getActorProfile(actor);
  if (!profile?.dispatchable) return null;
  if (!canAcceptRisk(profile, item.risk)) return null;
  if (role === 'reviewer'
    && !hasRoleTendency(profile, 'reviewer')
    && !hasRoleTendency(profile, 'critic')
    && profile.bestFor?.includes('review') !== true) {
    return null;
  }

  let score = 0;
  const reasons: string[] = [];

  if (profile.bestFor?.includes(item.intent)) add(35, `best-for:${item.intent}`);
  for (const capability of INTENT_CAPABILITY_HINTS[item.intent] ?? []) {
    if (profile.capabilities.includes(capability)) add(10, `capability:${capability}`);
  }

  if (hasRoleTendency(profile, role)) add(18, `role:${role}`);
  if (role === 'reviewer' && (hasRoleTendency(profile, 'reviewer') || hasRoleTendency(profile, 'critic'))) add(14, 'review-tendency');
  if (role === 'advisor' && (hasRoleTendency(profile, 'advisor') || hasRoleTendency(profile, 'critic'))) add(18, 'advisor-tendency');
  if (role === 'executor' && profile.kind === 'executor') add(30, 'executor-kind');

  if (item.risk === 'workspace_write' && profile.capabilities.some(c => ['repo-edit', 'tests', 'run-command'].includes(c))) {
    add(14, 'workspace-capable');
  }
  if (item.intent === 'architecture' && actor === 'akari') add(8, 'independent-peer-perspective');
  if (item.intent === 'review' && actor === 'claude') add(8, 'semantic-review-bias');
  if ((item.intent === 'code' || item.intent === 'diagnose') && actor === 'codex') add(12, 'engineering-primary-bias');
  if (item.intent === 'verify' && actor === 'shell') add(20, 'deterministic-fast-path');

  if (profile.cost === 'low') add(role === 'primary' && item.priority !== 'P0' ? 8 : 3, 'low-cost');
  if (profile.cost === 'high' && item.priority === 'P2') add(-8, 'high-cost-for-low-priority');
  applyHistoricalOutcome();
  if (profile.kind === 'human' && item.risk !== 'deploy' && item.risk !== 'external_write') add(-40, 'human-gate-not-needed');
  if (profile.kind === 'host-agent' && role !== 'advisor') add(-12, 'host-preserved-for-synthesis');
  if (profile.kind === 'executor' && role === 'primary' && item.intent !== 'verify') add(-35, 'executor-not-semantic-primary');
  if (profile.kind === 'peer-agent' && role === 'reviewer' && !['architecture', 'memory', 'policy'].includes(item.intent)) {
    add(-22, 'peer-advisor-not-default-reviewer');
  }
  if (profile.kind === 'peer-agent' && role === 'primary' && item.intent !== 'architecture' && item.intent !== 'policy') {
    add(-12, 'peer-not-default-primary');
  }

  return { actor, role, score, reasons };

  function add(delta: number, reason: string): void {
    score += delta;
    reasons.push(`${delta >= 0 ? '+' : ''}${delta} ${reason}`);
  }

  function applyHistoricalOutcome(): void {
    const stat = opts.actorStats?.[actor];
    if (!stat || stat.total < 3) return;
    const weight = Math.max(0.3, stat.confidence);
    if (stat.successRate >= 0.8) {
      add(Math.round(8 * weight), `historical-success:${stat.success}/${stat.total}`);
    } else if (stat.successRate <= 0.4) {
      add(-Math.round(14 * weight), `historical-failure:${stat.success}/${stat.total}`);
    }
    if (role === 'primary' && stat.avgDurationMs !== null && stat.avgDurationMs <= 2_000) {
      add(Math.round(3 * weight), `historical-fast:${stat.avgDurationMs}ms`);
    }
  }
}

function canAcceptRisk(profile: ActorProfile, risk: WorkRisk): boolean {
  if (!profile.risk) return true;
  return profile.risk.includes(risk);
}

function hasRoleTendency(profile: ActorProfile, role: ActorRoleTendency | SelectionRole): boolean {
  return profile.roleTendency.includes(role as ActorRoleTendency);
}
