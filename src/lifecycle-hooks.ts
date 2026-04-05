/**
 * Lifecycle Hooks — Configurable Event-Driven Automation
 *
 * Inspired by Claude Code's hook architecture:
 * - 10 lifecycle events covering the full agent cycle
 * - Hooks configured via JSON (agent-compose.yaml), not hardcoded
 * - Support shell scripts and HTTP webhooks
 * - Async execution option (non-blocking)
 * - Environment variable injection for event context
 *
 * Key difference from CC: Our hooks are autonomous-agent-aware.
 * CC hooks respond to human interaction events (UserPromptSubmit).
 * Our hooks respond to OODA cycle events (CycleStart, PerceptionComplete, etc.)
 */

import { execFile, type ChildProcess } from 'node:child_process';
import { slog } from './utils.js';
import { eventBus } from './event-bus.js';

// =============================================================================
// Types
// =============================================================================

/** All hookable lifecycle events */
export type HookEvent =
  | 'CycleStart'          // OODA cycle begins
  | 'CycleEnd'            // OODA cycle ends (success or fail)
  | 'PerceptionComplete'  // All perceptions collected
  | 'PreLLMCall'          // Before calling Claude/local LLM
  | 'PostLLMCall'         // After LLM response received
  | 'PreDispatch'         // Before processing agent tags
  | 'PostDispatch'        // After all tags processed
  | 'DelegationStart'     // Sub-task spawned
  | 'DelegationComplete'  // Sub-task finished
  | 'ErrorOccurred';      // Any error in the cycle

/** Hook execution type */
export type HookType = 'shell' | 'http';

/** Single hook definition */
export interface HookDefinition {
  /** Unique name for this hook */
  name: string;
  /** When to fire */
  event: HookEvent;
  /** Execution type */
  type: HookType;
  /** For shell: script path. For http: URL */
  target: string;
  /** Run async (don't block the cycle) */
  async?: boolean;
  /** Timeout in ms (default: 5000 for shell, 10000 for http) */
  timeout?: number;
  /** Only fire when condition matches (simple key=value on event data) */
  condition?: Record<string, string>;
  /** Environment variables to pass (shell only) */
  env?: Record<string, string>;
  /** Enabled flag (default: true) */
  enabled?: boolean;
}

/** Hook execution result */
export interface HookResult {
  hookName: string;
  event: HookEvent;
  success: boolean;
  output?: string;
  error?: string;
  durationMs: number;
}

/** Event context passed to hooks */
export interface HookContext {
  event: HookEvent;
  instanceId: string;
  cycleNumber: number;
  timestamp: string;
  data: Record<string, unknown>;
}

// =============================================================================
// Hook Manager
// =============================================================================

class HookManager {
  private hooks: HookDefinition[] = [];
  private results: HookResult[] = [];
  private readonly MAX_RESULTS = 100; // Rolling window

  /** Load hooks from configuration */
  loadHooks(hooks: HookDefinition[]): void {
    this.hooks = hooks.filter(h => h.enabled !== false);
    slog('HOOKS', `Loaded ${this.hooks.length} lifecycle hooks`);
  }

  /** Add a single hook */
  addHook(hook: HookDefinition): void {
    this.hooks.push(hook);
  }

  /** Remove hooks by name */
  removeHook(name: string): void {
    this.hooks = this.hooks.filter(h => h.name !== name);
  }

  /** Get all hooks for an event */
  getHooksForEvent(event: HookEvent): HookDefinition[] {
    return this.hooks.filter(h => h.event === event);
  }

  /** Fire all hooks for an event */
  async fireEvent(context: HookContext): Promise<HookResult[]> {
    const hooks = this.getHooksForEvent(context.event);
    if (hooks.length === 0) return [];

    const results: HookResult[] = [];
    const asyncHooks: Promise<HookResult>[] = [];

    for (const hook of hooks) {
      // Check condition
      if (hook.condition && !matchesCondition(hook.condition, context.data)) {
        continue;
      }

      const execution = executeHook(hook, context);

      if (hook.async) {
        // Fire and forget — but still track results
        asyncHooks.push(
          execution.then(r => {
            this.trackResult(r);
            return r;
          }).catch(err => {
            const errResult: HookResult = {
              hookName: hook.name,
              event: context.event,
              success: false,
              error: err instanceof Error ? err.message : String(err),
              durationMs: 0,
            };
            this.trackResult(errResult);
            return errResult;
          })
        );
      } else {
        // Blocking — wait for result
        try {
          const result = await execution;
          results.push(result);
          this.trackResult(result);
        } catch (err) {
          const errResult: HookResult = {
            hookName: hook.name,
            event: context.event,
            success: false,
            error: err instanceof Error ? err.message : String(err),
            durationMs: 0,
          };
          results.push(errResult);
          this.trackResult(errResult);
        }
      }
    }

    // Don't await async hooks — they run in background
    if (asyncHooks.length > 0) {
      Promise.allSettled(asyncHooks); // Fire-and-forget
    }

    return results;
  }

  /** Get recent hook results */
  getRecentResults(limit = 20): HookResult[] {
    return this.results.slice(-limit);
  }

  /** Track result in rolling window */
  private trackResult(result: HookResult): void {
    this.results.push(result);
    if (this.results.length > this.MAX_RESULTS) {
      this.results = this.results.slice(-this.MAX_RESULTS);
    }

    // Emit to event bus for observability
    eventBus.emit('log:info', {
      tag: 'hook',
      hookName: result.hookName,
      event: result.event,
      success: result.success,
      durationMs: result.durationMs,
      ...(result.error ? { error: result.error } : {}),
    });
  }

  /** Get hook count */
  get size(): number {
    return this.hooks.length;
  }
}

// Singleton
export const hookManager = new HookManager();

// =============================================================================
// Execution
// =============================================================================

async function executeHook(hook: HookDefinition, context: HookContext): Promise<HookResult> {
  const startMs = Date.now();

  if (hook.type === 'shell') {
    return executeShellHook(hook, context, startMs);
  } else if (hook.type === 'http') {
    return executeHttpHook(hook, context, startMs);
  }

  return {
    hookName: hook.name,
    event: context.event,
    success: false,
    error: `Unknown hook type: ${hook.type}`,
    durationMs: Date.now() - startMs,
  };
}

async function executeShellHook(hook: HookDefinition, context: HookContext, startMs: number): Promise<HookResult> {
  const timeout = hook.timeout ?? 5000;

  // Build environment
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    AGENT_EVENT: context.event,
    AGENT_INSTANCE_ID: context.instanceId,
    AGENT_CYCLE_NUMBER: String(context.cycleNumber),
    AGENT_TIMESTAMP: context.timestamp,
    AGENT_EVENT_DATA: JSON.stringify(context.data),
    ...(hook.env ?? {}),
  };

  // Add flattened event data as AGENT_DATA_* vars
  for (const [k, v] of Object.entries(context.data)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      env[`AGENT_DATA_${k.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`] = String(v);
    }
  }

  try {
    const output = await new Promise<string>((resolve, reject) => {
      execFile(
        hook.target,
        [],
        {
          encoding: 'utf-8',
          timeout,
          maxBuffer: 512 * 1024, // 512KB
          env,
        },
        (error, stdout, stderr) => {
          if (error) reject(Object.assign(error, { stderr }));
          else resolve(stdout);
        },
      );
    });

    return {
      hookName: hook.name,
      event: context.event,
      success: true,
      output: output.trim().slice(0, 2000), // Cap output
      durationMs: Date.now() - startMs,
    };
  } catch (err) {
    return {
      hookName: hook.name,
      event: context.event,
      success: false,
      error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
      durationMs: Date.now() - startMs,
    };
  }
}

async function executeHttpHook(hook: HookDefinition, context: HookContext, startMs: number): Promise<HookResult> {
  const timeout = hook.timeout ?? 10000;

  try {
    const resp = await fetch(hook.target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(context),
      signal: AbortSignal.timeout(timeout),
    });

    const text = await resp.text();
    return {
      hookName: hook.name,
      event: context.event,
      success: resp.ok,
      output: text.slice(0, 2000),
      error: resp.ok ? undefined : `HTTP ${resp.status}`,
      durationMs: Date.now() - startMs,
    };
  } catch (err) {
    return {
      hookName: hook.name,
      event: context.event,
      success: false,
      error: (err instanceof Error ? err.message : String(err)).slice(0, 500),
      durationMs: Date.now() - startMs,
    };
  }
}

// =============================================================================
// Helpers
// =============================================================================

/** Check if event data matches condition (simple equality) */
function matchesCondition(condition: Record<string, string>, data: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(condition)) {
    if (String(data[key]) !== expected) return false;
  }
  return true;
}

/**
 * Parse hooks from agent-compose.yaml format.
 *
 * Example YAML:
 * ```yaml
 * hooks:
 *   - name: log-cycle
 *     event: CycleStart
 *     type: shell
 *     target: scripts/log-cycle.sh
 *     async: true
 *   - name: notify-complete
 *     event: DelegationComplete
 *     type: http
 *     target: http://localhost:8080/webhook
 *     condition:
 *       status: completed
 * ```
 */
export function parseHooksFromConfig(config: Record<string, unknown>[]): HookDefinition[] {
  return config.map(h => ({
    name: String(h.name ?? 'unnamed'),
    event: String(h.event ?? 'CycleEnd') as HookEvent,
    type: (String(h.type ?? 'shell')) as HookType,
    target: String(h.target ?? ''),
    async: h.async === true,
    timeout: typeof h.timeout === 'number' ? h.timeout : undefined,
    condition: h.condition as Record<string, string> | undefined,
    env: h.env as Record<string, string> | undefined,
    enabled: h.enabled !== false,
  }));
}

/**
 * Helper: Create hook context for firing events.
 * Used by the main loop and delegation system.
 */
export function createHookContext(
  event: HookEvent,
  instanceId: string,
  cycleNumber: number,
  data: Record<string, unknown> = {},
): HookContext {
  return {
    event,
    instanceId,
    cycleNumber,
    timestamp: new Date().toISOString(),
    data,
  };
}
