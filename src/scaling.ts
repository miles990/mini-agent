/**
 * Dynamic Scaling Controller — Cognitive Mesh Phase 3
 *
 * Decides when to scale up (spawn new Specialist) or scale down (stop idle ones).
 * Uses instance heartbeats to monitor neighbor liveness and load.
 *
 * Scale up: queue depth > threshold + parallelizable tasks pending
 * Scale down: specialist idle > timeout
 *
 * Safety: hard max on instances, cooldown between scale events, anti-flapping.
 */

import { getNeighborHeartbeats, isInstanceAlive } from './instance.js';
import type { InstanceHeartbeat } from './types.js';
import type { PerspectiveType } from './task-router.js';
import { slog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

export interface ScalingDecision {
  action: 'scale-up' | 'scale-down' | 'none';
  reason: string;
  perspective?: PerspectiveType;   // for scale-up
  targetInstance?: string;          // for scale-down
}

export interface ScalingConfig {
  maxInstances: number;          // absolute cap (primary + specialists)
  idleTimeoutMs: number;         // how long a specialist can be idle before shutdown
  scaleUpCooldownMs: number;     // min time between scale-up events
  queueDepthThreshold: number;   // queue depth to trigger scale-up
}

// =============================================================================
// Defaults
// =============================================================================

const DEFAULT_CONFIG: ScalingConfig = {
  maxInstances: 3,               // primary + 2 specialists (conservative for 16GB RAM)
  idleTimeoutMs: 5 * 60_000,    // 5 minutes
  scaleUpCooldownMs: 30_000,     // 30 seconds
  queueDepthThreshold: 2,        // scale up when queue > 2
};

let lastScaleUpAt = 0;
let config: ScalingConfig = { ...DEFAULT_CONFIG };

// =============================================================================
// Configuration
// =============================================================================

/**
 * Update scaling configuration (e.g., from compose v2).
 */
export function setScalingConfig(partial: Partial<ScalingConfig>): void {
  config = { ...config, ...partial };
}

function getScalingConfig(): ScalingConfig {
  return { ...config };
}

// =============================================================================
// Scaling Decisions
// =============================================================================

/**
 * Evaluate whether to scale up, down, or do nothing.
 * Called periodically (e.g., at end of each OODA cycle).
 */
export function evaluateScaling(opts: {
  primaryQueueDepth: number;
  hasParallelizableTasks: boolean;
}): ScalingDecision {
  const neighbors = getNeighborHeartbeats();
  const totalInstances = 1 + neighbors.length;
  const now = Date.now();

  // ── Scale Up Check ──
  if (
    opts.primaryQueueDepth > config.queueDepthThreshold &&
    opts.hasParallelizableTasks &&
    totalInstances < config.maxInstances &&
    now - lastScaleUpAt > config.scaleUpCooldownMs
  ) {
    const perspective = inferNeededPerspective(neighbors);
    return {
      action: 'scale-up',
      reason: `queue=${opts.primaryQueueDepth}, instances=${totalInstances}/${config.maxInstances}`,
      perspective,
    };
  }

  // ── Scale Down Check ──
  const idleSpecialist = findIdleSpecialist(neighbors, now);
  if (idleSpecialist) {
    const idleMs = now - idleSpecialist.ts;
    return {
      action: 'scale-down',
      reason: `idle ${Math.round(idleMs / 1000)}s > ${config.idleTimeoutMs / 1000}s threshold`,
      targetInstance: idleSpecialist.instanceId,
    };
  }

  return { action: 'none', reason: 'stable' };
}

/**
 * Record that a scale-up happened (call after successful spawn).
 */
export function recordScaleUp(): void {
  lastScaleUpAt = Date.now();
}

// =============================================================================
// Internal Helpers
// =============================================================================

function findIdleSpecialist(
  neighbors: InstanceHeartbeat[],
  now: number,
): InstanceHeartbeat | null {
  for (const n of neighbors) {
    if (n.role === 'master') continue; // never scale down primary
    if (n.status === 'idle' && now - n.ts > config.idleTimeoutMs) {
      // Double-check liveness before recommending shutdown
      if (isInstanceAlive(n.instanceId)) {
        return n;
      }
    }
  }
  return null;
}

/**
 * Infer what perspective is most needed based on current cluster composition.
 */
function inferNeededPerspective(neighbors: InstanceHeartbeat[]): PerspectiveType {
  const perspectives = new Set(neighbors.map(n => n.perspective).filter(Boolean));

  // Priority: research > code > chat (research is most commonly parallelizable)
  if (!perspectives.has('research')) return 'research';
  if (!perspectives.has('code')) return 'code';
  if (!perspectives.has('chat')) return 'chat';

  // All perspectives covered — add another research
  return 'research';
}

/**
 * Check if scaling is healthy (for observability).
 */
export function getScalingStatus(): {
  totalInstances: number;
  maxInstances: number;
  neighbors: Array<{ id: string; perspective?: string; status: string; idleMs: number }>;
  canScaleUp: boolean;
} {
  const neighbors = getNeighborHeartbeats();
  const now = Date.now();

  return {
    totalInstances: 1 + neighbors.length,
    maxInstances: config.maxInstances,
    neighbors: neighbors.map(n => ({
      id: n.instanceId,
      perspective: n.perspective,
      status: n.status,
      idleMs: n.status === 'idle' ? now - n.ts : 0,
    })),
    canScaleUp: 1 + neighbors.length < config.maxInstances && now - lastScaleUpAt > config.scaleUpCooldownMs,
  };
}
