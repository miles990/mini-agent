/**
 * Mesh Handler — Cognitive Mesh Route Execution
 *
 * Executes routing decisions from task-router:
 * - forward: send task to an existing idle specialist
 * - spawn: create a new specialist instance + forward
 * - queue: defer task for later processing
 *
 * Also handles scaling decisions (scale-up/scale-down).
 */

import fs from 'node:fs';
import path from 'node:path';
import { getInstanceManager, getNeighborHeartbeats, getDataDir } from './instance.js';
import { recordSpawn, type RouteDecision, type PerspectiveType } from './task-router.js';
import { recordScaleUp, type ScalingDecision } from './scaling.js';
import { emitIPC } from './ipc-bus.js';
import { slog } from './utils.js';

// =============================================================================
// Types
// =============================================================================

interface QueuedTask {
  trigger: string;
  ts: number;
  perspective?: string;
}

// =============================================================================
// Route Execution
// =============================================================================

/**
 * Execute a non-self routing decision.
 * Returns true if task was successfully routed away from primary.
 */
export async function handleMeshRoute(
  route: RouteDecision,
  triggerReason: string,
): Promise<boolean> {
  switch (route.action) {
    case 'forward': {
      if (!route.targetInstance) return false;
      return forwardToInstance(route.targetInstance, triggerReason);
    }

    case 'spawn': {
      const instanceId = await spawnSpecialist(route.perspective ?? 'research');
      if (!instanceId) return false;
      return forwardToInstance(instanceId, triggerReason);
    }

    case 'queue':
      queueMeshTask(triggerReason, route.perspective);
      return true;

    default:
      return false;
  }
}

// =============================================================================
// Forward
// =============================================================================

/**
 * Forward a trigger to a specific instance via HTTP.
 */
async function forwardToInstance(targetInstanceId: string, trigger: string): Promise<boolean> {
  const neighbors = getNeighborHeartbeats();
  const target = neighbors.find(n => n.instanceId === targetInstanceId);
  if (!target) {
    slog('MESH', `Forward failed: instance ${targetInstanceId} not found in neighbors`);
    return false;
  }

  try {
    const res = await fetch(`http://localhost:${target.port}/api/mesh/task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        trigger,
        from: process.env.MINI_AGENT_INSTANCE || 'unknown',
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      slog('MESH', `Forward failed: ${targetInstanceId} returned ${res.status}`);
      return false;
    }

    slog('MESH', `Forwarded trigger="${trigger}" → ${targetInstanceId}:${target.port}`);
    return true;
  } catch (err) {
    slog('MESH', `Forward error: ${targetInstanceId} — ${err instanceof Error ? err.message : 'unknown'}`);
    return false;
  }
}

// =============================================================================
// Spawn
// =============================================================================

/**
 * Spawn a new specialist instance with the given perspective.
 * Returns instance ID on success, null on failure.
 */
async function spawnSpecialist(perspective: PerspectiveType): Promise<string | null> {
  const mgr = getInstanceManager();

  try {
    const config = await mgr.create({
      name: `specialist-${perspective}`,
      role: 'worker',
    });

    // Write perspective config so specialist knows its role on startup
    const perspectivePath = path.join(getDataDir(), 'instances', config.id, 'perspective.json');
    fs.writeFileSync(perspectivePath, JSON.stringify({ perspective }));

    // Start the instance via launchd
    await mgr.start(config.id);

    // Record spawn for rate limiting
    recordSpawn();
    recordScaleUp();

    slog('MESH', `Spawned specialist: ${config.id} (${perspective}) on :${config.port}`);

    // Notify via IPC
    emitIPC('action:loop', {
      event: 'specialist.spawned',
      instanceId: config.id,
      perspective,
    });

    return config.id;
  } catch (err) {
    slog('MESH', `Spawn failed: ${err instanceof Error ? err.message : 'unknown'}`);
    return null;
  }
}

// =============================================================================
// Queue
// =============================================================================

function getQueuePath(): string {
  return path.join(getDataDir(), 'mesh-queue.jsonl');
}

/**
 * Queue a task for later processing.
 */
function queueMeshTask(trigger: string, perspective?: string): void {
  const entry: QueuedTask = { trigger, ts: Date.now(), perspective };
  try {
    fs.appendFileSync(getQueuePath(), JSON.stringify(entry) + '\n');
    slog('MESH', `Queued task: trigger=${trigger}`);
  } catch (err) {
    slog('MESH', `Queue write failed: ${err instanceof Error ? err.message : 'unknown'}`);
  }
}

/**
 * Drain one queued task (called when primary has capacity).
 * Returns the task if dequeued, null otherwise.
 */
export function drainMeshQueue(): QueuedTask | null {
  const queuePath = getQueuePath();
  try {
    if (!fs.existsSync(queuePath)) return null;

    const content = fs.readFileSync(queuePath, 'utf-8').trim();
    if (!content) return null;

    const lines = content.split('\n').filter(Boolean);
    if (lines.length === 0) return null;

    const first = JSON.parse(lines[0]) as QueuedTask;
    const remaining = lines.slice(1).join('\n');

    if (remaining) {
      fs.writeFileSync(queuePath, remaining + '\n');
    } else {
      try { fs.unlinkSync(queuePath); } catch { /* ok */ }
    }

    slog('MESH', `Drained queued task: trigger=${first.trigger}`);
    return first;
  } catch {
    return null;
  }
}

// =============================================================================
// Scaling Execution
// =============================================================================

/**
 * Execute a scaling decision (scale-up or scale-down).
 */
export async function executeScaling(decision: ScalingDecision): Promise<void> {
  if (decision.action === 'scale-up') {
    const perspective = decision.perspective ?? 'research';
    const instanceId = await spawnSpecialist(perspective);
    if (instanceId) {
      slog('MESH', `Scaled up: ${instanceId} (${perspective}) — ${decision.reason}`);
    }
  } else if (decision.action === 'scale-down' && decision.targetInstance) {
    const mgr = getInstanceManager();
    try {
      mgr.stop(decision.targetInstance);
      mgr.delete(decision.targetInstance);
      slog('MESH', `Scaled down: ${decision.targetInstance} — ${decision.reason}`);
    } catch (err) {
      slog('MESH', `Scale-down failed: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }
}
