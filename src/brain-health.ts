/**
 * Brain Health Registry.
 *
 * Health checks are async while delegation spawn is intentionally sync. This
 * module keeps a recent actor availability snapshot for the arbiter and exposes
 * explicit refresh for APIs and runtime warmup.
 */

import type { ActorId, BrainProvider, PeerAgentId, ProviderHealth, ProviderId } from './brain-types.js';
import type { PeerAgent } from './peer-agent.js';

export interface BrainActorHealth {
  actor: ActorId;
  kind: 'provider' | 'peer' | 'built-in';
  available: boolean;
  detail?: string;
  checkedAt: string;
}

export interface BrainHealthSnapshot {
  checkedAt: string;
  actors: BrainActorHealth[];
  availableActors: ActorId[];
}

const BUILT_INS: ActorId[] = ['kuro', 'human'];
const DEFAULT_AVAILABLE: ActorId[] = ['claude', 'codex', 'local', 'shell', 'akari', 'tanren'];

let cachedSnapshot: BrainHealthSnapshot | null = null;

export async function refreshBrainHealth(
  providers: BrainProvider[] = [],
  peers: PeerAgent[] = [],
  now = new Date(),
): Promise<BrainHealthSnapshot> {
  const checkedAt = now.toISOString();
  const providerHealth = await Promise.all(providers.map(async provider =>
    actorHealth(provider.id, 'provider', checkedAt, () => provider.health()),
  ));
  const peerHealth = await Promise.all(peers.map(async peer =>
    actorHealth(peer.id, 'peer', checkedAt, () => peer.health()),
  ));
  const builtIns = BUILT_INS.map(actor => ({
    actor,
    kind: 'built-in' as const,
    available: true,
    checkedAt,
  }));

  cachedSnapshot = {
    checkedAt,
    actors: [...providerHealth, ...peerHealth, ...builtIns],
    availableActors: [...providerHealth, ...peerHealth, ...builtIns]
      .filter(actor => actor.available)
      .map(actor => actor.actor),
  };
  return cachedSnapshot;
}

export function getCachedBrainHealthSnapshot(): BrainHealthSnapshot {
  if (cachedSnapshot) return cachedSnapshot;
  const checkedAt = new Date(0).toISOString();
  return {
    checkedAt,
    actors: DEFAULT_AVAILABLE.map(actor => ({
      actor,
      kind: isPeer(actor) ? 'peer' : 'provider',
      available: true,
      checkedAt,
      detail: 'optimistic default before first health refresh',
    })),
    availableActors: DEFAULT_AVAILABLE,
  };
}

export function getCachedAvailableBrainActors(): ActorId[] {
  return getCachedBrainHealthSnapshot().availableActors;
}

export function isBrainRuntimeDelegationEnabled(): boolean {
  const value = process.env.MINI_AGENT_DELEGATION_RUNTIME?.toLowerCase();
  return value === 'true' || value === '1';
}

async function actorHealth(
  actor: ProviderId | PeerAgentId,
  kind: BrainActorHealth['kind'],
  checkedAt: string,
  check: () => Promise<ProviderHealth>,
): Promise<BrainActorHealth> {
  try {
    const health = await check();
    return {
      actor,
      kind,
      available: health.available,
      checkedAt,
      ...(health.detail ? { detail: health.detail } : {}),
    };
  } catch (err) {
    return {
      actor,
      kind,
      available: false,
      checkedAt,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function isPeer(actor: ActorId): boolean {
  return actor === 'akari' || actor === 'tanren';
}
