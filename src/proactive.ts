/**
 * Proactive System - Legacy cron-based heartbeat
 *
 * In OODA-Only architecture, this is superseded by AgentLoop (loop.ts) + Cron (cron.ts).
 * Kept for backwards compatibility — startProactive() no-ops when loop is active.
 */

import cron from 'node-cron';
import { callClaude } from './agent.js';
import { postProcess } from './dispatcher.js';
import { buildContext } from './memory.js';
import { getLogger } from './logging.js';

let heartbeatTask: cron.ScheduledTask | null = null;

export interface ProactiveConfig {
  /** Cron expression (default: every 30 minutes) */
  schedule?: string;
  /** Callback when heartbeat runs */
  onHeartbeat?: (result: string | null) => void;
}

/**
 * Start proactive heartbeat
 */
export function startProactive(config: ProactiveConfig & { loopEnabled?: boolean } = {}): void {
  if (config.loopEnabled) {
    console.log('[Proactive] Skipped - AgentLoop is active');
    return;
  }

  const schedule = config.schedule ?? '*/30 * * * *'; // Every 30 minutes
  const logger = getLogger();

  if (heartbeatTask) {
    heartbeatTask.stop();
  }

  heartbeatTask = cron.schedule(schedule, async () => {
    console.log('[Proactive] Running heartbeat check...');
    logger.logCron('cron-trigger', undefined, schedule);

    const result = await runHeartbeat();

    if (result && config.onHeartbeat) {
      config.onHeartbeat(result);
    }

    if (result) {
      console.log('[Proactive] Heartbeat result:', result.slice(0, 100));
    } else {
      console.log('[Proactive] No action needed');
    }
  });

  logger.logCron('start', `Started with schedule: ${schedule}`);
  console.log(`[Proactive] Started with schedule: ${schedule}`);
}

/**
 * Stop proactive heartbeat
 */
export function stopProactive(): void {
  if (heartbeatTask) {
    heartbeatTask.stop();
    heartbeatTask = null;
    const logger = getLogger();
    logger.logCron('stop', 'Proactive system stopped');
    console.log('[Proactive] Stopped');
  }
}

/**
 * Manually trigger heartbeat
 */
export async function triggerHeartbeat(): Promise<string | null> {
  const logger = getLogger();
  logger.logCron('manual-trigger', 'Manual heartbeat triggered');
  console.log('[Proactive] Manual heartbeat triggered');
  return runHeartbeat();
}

/** Internal heartbeat via callClaude */
async function runHeartbeat(): Promise<string | null> {
  try {
    const prompt = 'Check HEARTBEAT.md for pending tasks and execute them if any.';
    const context = await buildContext();
    const result = await callClaude(prompt, context, 2, { source: 'loop' });
    await postProcess(prompt, result.response, {
      lane: 'heartbeat', duration: result.duration, source: 'proactive',
      systemPrompt: result.systemPrompt, context,
    });
    return result.response;
  } catch {
    return null;
  }
}
