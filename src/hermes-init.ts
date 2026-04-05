/**
 * Hermes Init — Unified Initialization for All v2 Systems
 *
 * Single entry point that wires up:
 * 1. Tool Registry (built-in + shell script tools)
 * 2. Lifecycle Hooks (from compose config)
 * 3. Active Context (decision persistence)
 * 4. Skill System v2 (on-demand index)
 * 5. Rules Engine (path-based rules)
 * 6. Structured Logging (JSONL + correlation)
 * 7. Blast Radius Classification (action safety)
 * 8. Agent Isolation (handoff cleanup)
 *
 * Called once at startup (from loop.ts or cli.ts).
 * All systems are opt-in: if config doesn't specify hooks, none fire.
 */

import { toolRegistry, registerBuiltinTools, registerShellTool } from './tool-registry.js';
import { hookManager, parseHooksFromConfig, createHookContext, type HookEvent } from './lifecycle-hooks.js';
import { activeContext } from './active-context.js';
import { skillIndex } from './skill-system.js';
import { rulesEngine, getDefaultRulesDirs } from './rules-engine.js';
import { structuredLog, wireStructuredLogging } from './structured-log.js';
import { cleanupHandoff } from './agent-isolation.js';
import { eventBus } from './event-bus.js';
import { slog } from './utils.js';
import { getCurrentInstanceId } from './instance.js';
import type { ComposeAgent, ComposePerception } from './types.js';

// =============================================================================
// Initialization
// =============================================================================

export interface HermesInitResult {
  toolCount: number;
  hookCount: number;
  skillCount: number;
  ruleCount: number;
  activeDecisions: number;
}

/**
 * Initialize all Hermes-inspired systems.
 *
 * @param composeAgent - Agent config from agent-compose.yaml (optional)
 * @param workdir - Working directory for path resolution
 */
export function initHermes(
  composeAgent?: ComposeAgent,
  workdir?: string,
): HermesInitResult {
  const cwd = workdir ?? process.cwd();

  // 1. Tool Registry
  registerBuiltinTools();

  // Register custom perception scripts as tools
  if (composeAgent?.perception?.custom) {
    for (const p of composeAgent.perception.custom) {
      if (p.enabled === false) continue;
      registerShellTool({
        name: `perception:${p.name}`,
        description: `Perception plugin: ${p.name}`,
        script: p.script,
        cwd,
        timeout: p.timeout,
        tags: ['perception', 'custom'],
      });
    }
  }

  // 2. Lifecycle Hooks
  if (composeAgent?.hooks?.length) {
    const hooks = parseHooksFromConfig(composeAgent.hooks as Record<string, unknown>[]);
    hookManager.loadHooks(hooks);
  }

  // 3. Active Context
  activeContext.load();

  // 4. Skill System v2
  const skillPaths = composeAgent?.skills ?? [];
  if (skillPaths.length > 0) {
    skillIndex.buildIndex(skillPaths, cwd);
  }

  // 5. Rules Engine
  const rulesDirs = composeAgent?.rules?.length
    ? composeAgent.rules.map(r => {
        const path = require('node:path');
        return path.isAbsolute(r) ? r : path.resolve(cwd, r);
      })
    : getDefaultRulesDirs(cwd);
  if (rulesDirs.length > 0) {
    rulesEngine.loadRules(rulesDirs);
  }

  // 6. Structured Logging
  wireStructuredLogging();

  // 7. Handoff cleanup (agent isolation)
  cleanupHandoff();

  // 8. Wire lifecycle hooks to event bus
  wireHooksToEventBus();

  const result: HermesInitResult = {
    toolCount: toolRegistry.size,
    hookCount: hookManager.size,
    skillCount: skillIndex.size,
    ruleCount: rulesEngine.size,
    activeDecisions: activeContext.size,
  };

  slog('HERMES', `Initialized: ${result.toolCount} tools, ${result.hookCount} hooks, ${result.skillCount} skills, ${result.ruleCount} rules, ${result.activeDecisions} active decisions`);

  return result;
}

// =============================================================================
// Event Bus ↔ Lifecycle Hooks Bridge
// =============================================================================

/** Map event bus events to lifecycle hook events */
const EVENT_TO_HOOK: Array<{ busEvent: string; hookEvent: HookEvent }> = [
  { busEvent: 'hook:cycle-start', hookEvent: 'CycleStart' },
  { busEvent: 'hook:cycle-end', hookEvent: 'CycleEnd' },
  { busEvent: 'hook:perception-complete', hookEvent: 'PerceptionComplete' },
  { busEvent: 'hook:pre-llm', hookEvent: 'PreLLMCall' },
  { busEvent: 'hook:post-llm', hookEvent: 'PostLLMCall' },
  { busEvent: 'hook:pre-dispatch', hookEvent: 'PreDispatch' },
  { busEvent: 'hook:post-dispatch', hookEvent: 'PostDispatch' },
  { busEvent: 'hook:delegation-start', hookEvent: 'DelegationStart' },
  { busEvent: 'hook:delegation-complete', hookEvent: 'DelegationComplete' },
  { busEvent: 'hook:error', hookEvent: 'ErrorOccurred' },
];

function wireHooksToEventBus(): void {
  for (const mapping of EVENT_TO_HOOK) {
    eventBus.on(mapping.busEvent as any, (event) => {
      const context = createHookContext(
        mapping.hookEvent,
        getCurrentInstanceId(),
        (event.data.cycleNumber as number) ?? 0,
        event.data,
      );
      // Fire hooks — don't await (non-blocking)
      hookManager.fireEvent(context).catch(() => {});
    });
  }
}

// =============================================================================
// Cycle Integration Helpers
// =============================================================================

/**
 * Fire hooks at the start of an OODA cycle.
 * Called from loop.ts at the beginning of each cycle.
 */
export function fireCycleStart(cycleNumber: number, data?: Record<string, unknown>): void {
  eventBus.emit('hook:cycle-start' as any, { cycleNumber, ...data });
}

/**
 * Fire hooks at the end of an OODA cycle.
 * Called from loop.ts at the end of each cycle.
 */
export function fireCycleEnd(cycleNumber: number, data?: Record<string, unknown>): void {
  eventBus.emit('hook:cycle-end' as any, { cycleNumber, ...data });
}

/**
 * Fire hooks after all perceptions are collected.
 */
export function firePerceptionComplete(cycleNumber: number, data?: Record<string, unknown>): void {
  eventBus.emit('hook:perception-complete' as any, { cycleNumber, ...data });
}

/**
 * Fire hooks before calling the LLM.
 */
export function firePreLLM(cycleNumber: number, data?: Record<string, unknown>): void {
  eventBus.emit('hook:pre-llm' as any, { cycleNumber, ...data });
}

/**
 * Fire hooks after LLM response received.
 */
export function firePostLLM(cycleNumber: number, data?: Record<string, unknown>): void {
  eventBus.emit('hook:post-llm' as any, { cycleNumber, ...data });
}

/**
 * Fire hooks before dispatching tags.
 */
export function firePreDispatch(cycleNumber: number, data?: Record<string, unknown>): void {
  eventBus.emit('hook:pre-dispatch' as any, { cycleNumber, ...data });
}

/**
 * Fire hooks after dispatching tags.
 */
export function firePostDispatch(cycleNumber: number, data?: Record<string, unknown>): void {
  eventBus.emit('hook:post-dispatch' as any, { cycleNumber, ...data });
}

/**
 * Get context injection for the current cycle.
 * Combines: active decisions + matched rules + matched skills.
 * Called from prompt-builder.ts or memory.ts during context building.
 */
export function getHermesContextInjection(opts?: {
  filePaths?: string[];
  eventType?: string;
  keywords?: string[];
  cycleMode?: string;
  perceptionSummary?: string;
}): string {
  const parts: string[] = [];

  // Active Context (decisions)
  const activeCtx = activeContext.formatForInjection();
  if (activeCtx) parts.push(activeCtx);

  // Matched Rules
  const ruleMatches = rulesEngine.match({
    filePaths: opts?.filePaths,
    eventType: opts?.eventType,
    keywords: opts?.keywords,
  });
  const rulesCtx = rulesEngine.formatForContext(ruleMatches);
  if (rulesCtx) parts.push(rulesCtx);

  // Matched Skills
  const skillMatches = skillIndex.loadMatched({
    mode: opts?.cycleMode,
    keywords: opts?.keywords,
    perceptionSummary: opts?.perceptionSummary,
  });
  if (skillMatches.length > 0) {
    const { formatSkillsForPrompt } = require('./skill-system.js');
    const skillsCtx = formatSkillsForPrompt(skillMatches);
    if (skillsCtx) parts.push(skillsCtx);
  }

  return parts.join('\n\n');
}
