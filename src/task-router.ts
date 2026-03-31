/**
 * Task Router — Cognitive Mesh Phase 3
 *
 * Decides where a trigger event should be handled:
 * - self: handle in this (Primary) instance
 * - spawn: start a new Specialist instance
 * - forward: send to an existing idle Specialist
 * - queue: wait for an available slot
 *
 * Design: Primary always handles identity tasks (Alex DM, Telegram).
 * Independent research/code tasks can be parallelized to Specialists.
 */

import { getNeighborHeartbeats } from './instance.js';
import { MUSHI_ROUTE_URL } from './mushi-client.js';
import type { InstanceHeartbeat } from './types.js';

// =============================================================================
// Types
// =============================================================================

export type RouteAction = 'self' | 'spawn' | 'forward' | 'queue';
export type PerspectiveType = 'primary' | 'chat' | 'research' | 'code';

export interface RouteDecision {
  action: RouteAction;
  reason: string;
  targetInstance?: string;     // for 'forward'
  perspective?: PerspectiveType; // for 'spawn'
  priority: 'P0' | 'P1' | 'P2' | 'P3';
}

export interface ClusterState {
  neighbors: InstanceHeartbeat[];
  primaryBusy: boolean;
  primaryQueueDepth: number;
  totalInstances: number;
  maxInstances: number;
}

// =============================================================================
// Constants
// =============================================================================

const DIRECT_MESSAGE_SOURCES = new Set(['telegram', 'room', 'chat', 'telegram-user', 'direct-message']);

/** Max total instances (primary + specialists) */
const DEFAULT_MAX_INSTANCES = 3;

// TODO: MIN_SPAWN_DURATION_MS (30s) — was planned to skip spawning for quick tasks, never wired up

/** Cooldown between consecutive spawns */
const SPAWN_COOLDOWN_MS = 30_000;

/** Max spawns per minute to prevent fork bombs */
const MAX_SPAWNS_PER_MINUTE = 2;

let lastSpawnAt = 0;
let spawnsThisMinute = 0;
let spawnsMinuteStart = 0;

// =============================================================================
// Route Decision
// =============================================================================

/**
 * Decide how to handle a trigger event.
 */
export function routeTask(
  triggerType: string,
  triggerData: Record<string, unknown>,
  state: ClusterState,
): RouteDecision {
  // 1. Direct messages → always self (identity required)
  // Extract base trigger name: strip 'trigger:' prefix, then take first token
  // Handles: "trigger:room (yielded)", "workspace: {json}", "startup (hint)", "heartbeat"
  const raw = triggerType.replace('trigger:', '').trim();
  const triggerBase = raw.split(/[\s:(]/)[0];
  if (DIRECT_MESSAGE_SOURCES.has(triggerBase)) {
    return {
      action: 'self',
      reason: 'identity-required',
      priority: 'P0',
    };
  }

  // 2. Alerts → always self
  if (triggerBase === 'alert') {
    return {
      action: 'self',
      reason: 'alert-handling',
      priority: 'P1',
    };
  }

  // 3. Routine triggers → always self (not worth parallelizing)
  const ROUTINE_TRIGGERS = new Set(['heartbeat', 'cron', 'mobile', 'delegation-complete', 'startup']);
  if (ROUTINE_TRIGGERS.has(triggerBase)) {
    return {
      action: 'self',
      reason: 'routine-self',
      priority: 'P3',
    };
  }

  // 4. Check if there's an idle specialist that matches
  const specialist = findIdleSpecialist(state.neighbors, triggerBase);
  if (specialist) {
    return {
      action: 'forward',
      targetInstance: specialist.instanceId,
      reason: 'specialist-available',
      priority: 'P2',
    };
  }

  // 5. If primary is busy + task is parallelizable + room to spawn
  if (
    state.primaryBusy &&
    isParallelizable(triggerBase, triggerData) &&
    canSpawn(state)
  ) {
    return {
      action: 'spawn',
      perspective: inferPerspective(triggerBase, triggerData),
      reason: 'load-balance',
      priority: 'P2',
    };
  }

  // 6. If primary is busy + can't spawn → queue
  if (state.primaryBusy && state.primaryQueueDepth > 0) {
    return {
      action: 'queue',
      reason: 'primary-busy',
      priority: 'P3',
    };
  }

  // 7. Default → handle self
  return {
    action: 'self',
    reason: 'default',
    priority: 'P2',
  };
}

// =============================================================================
// Parallelizability Analysis
// =============================================================================

/**
 * Determine if a trigger can be safely handled in parallel.
 */
function isParallelizable(triggerBase: string, data: Record<string, unknown>): boolean {
  // Direct messages need identity — not parallelizable
  if (DIRECT_MESSAGE_SOURCES.has(triggerBase)) return false;

  // Tasks with explicit dependencies — not parallelizable
  if (data.dependsOn) return false;

  // Tasks that write shared resources — not parallelizable (unless locked)
  if (data.writesTo && isSharedResource(data.writesTo as string)) return false;

  // Heartbeat, workspace changes, cron tasks — can be parallelized
  return true;
}

function isSharedResource(resource: string): boolean {
  const shared = ['MEMORY.md', 'HEARTBEAT.md', 'SOUL.md', 'index/relations.jsonl'];
  return shared.some(s => resource.includes(s));
}

// =============================================================================
// Specialist Matching
// =============================================================================

function findIdleSpecialist(
  neighbors: InstanceHeartbeat[],
  triggerBase: string,
): InstanceHeartbeat | null {
  const perspective = inferPerspective(triggerBase, {});

  return neighbors.find(n =>
    n.status === 'idle' &&
    n.perspective === perspective,
  ) ?? null;
}

function inferPerspective(
  triggerBase: string,
  data: Record<string, unknown>,
): PerspectiveType {
  // Workspace/git changes → code perspective
  if (triggerBase === 'workspace' || data.type === 'code') return 'code';

  // Web/chrome triggers → research perspective
  if (triggerBase === 'web' || triggerBase === 'chrome' || data.type === 'research') return 'research';

  // Chat-related (but not direct) → chat perspective
  if (triggerBase === 'room' || triggerBase === 'chat') return 'chat';

  // Default to research for unknown tasks
  return 'research';
}

// =============================================================================
// Spawn Control (Anti-Fork-Bomb)
// =============================================================================

function canSpawn(state: ClusterState): boolean {
  const now = Date.now();

  // Hard limit on total instances
  if (state.totalInstances >= state.maxInstances) return false;

  // Cooldown between spawns
  if (now - lastSpawnAt < SPAWN_COOLDOWN_MS) return false;

  // Rate limit: max N spawns per minute
  if (now - spawnsMinuteStart > 60_000) {
    spawnsThisMinute = 0;
    spawnsMinuteStart = now;
  }
  if (spawnsThisMinute >= MAX_SPAWNS_PER_MINUTE) return false;

  return true;
}

/**
 * Record that a spawn occurred (call after successful spawn).
 */
export function recordSpawn(): void {
  const now = Date.now();
  lastSpawnAt = now;
  spawnsThisMinute++;
  if (now - spawnsMinuteStart > 60_000) {
    spawnsThisMinute = 1;
    spawnsMinuteStart = now;
  }
}

// =============================================================================
// Cluster State
// =============================================================================

/**
 * Gather current cluster state for routing decisions.
 */
export function getClusterState(opts: {
  primaryBusy: boolean;
  primaryQueueDepth: number;
  maxInstances?: number;
}): ClusterState {
  const neighbors = getNeighborHeartbeats();
  return {
    neighbors,
    primaryBusy: opts.primaryBusy,
    primaryQueueDepth: opts.primaryQueueDepth,
    totalInstances: 1 + neighbors.length, // primary + specialists
    maxInstances: opts.maxInstances ?? DEFAULT_MAX_INSTANCES,
  };
}

// =============================================================================
// mushi Integration (Phase 5) — Lightweight Routing Coordinator
// =============================================================================


interface MushiRouteResponse {
  route: RouteAction;
  target?: string;
  perspective?: PerspectiveType;
  reason: string;
  latencyMs: number;
}

/**
 * Ask mushi for a routing suggestion.
 * mushi's Llama 3.1 8B makes routing decisions in ~800ms at zero cost (HC1).
 * Fail-open: returns null if mushi is offline or errors.
 */
export async function mushiRoute(
  triggerType: string,
  state: ClusterState,
): Promise<RouteDecision | null> {
  try {
    const body = JSON.stringify({
      trigger: triggerType,
      cluster: {
        primaryBusy: state.primaryBusy,
        queueDepth: state.primaryQueueDepth,
        totalInstances: state.totalInstances,
        maxInstances: state.maxInstances,
        specialists: state.neighbors.map(n => ({
          id: n.instanceId,
          perspective: n.perspective,
          status: n.status,
        })),
      },
    });

    const res = await fetch(MUSHI_ROUTE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: AbortSignal.timeout(3000),
    });

    if (!res.ok) return null;
    const result = await res.json() as MushiRouteResponse;

    const validActions: RouteAction[] = ['self', 'spawn', 'forward', 'queue'];
    if (!validActions.includes(result.route)) return null;

    return {
      action: result.route,
      reason: `mushi: ${result.reason}`,
      targetInstance: result.target,
      perspective: result.perspective,
      priority: 'P2',
    };
  } catch {
    // mushi offline or /api/route not implemented yet — fail-open
    return null;
  }
}
