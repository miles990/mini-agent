/**
 * Blast Radius Classification — Action Safety Gate
 *
 * Inspired by Claude Code's permission model:
 * - Every action classified by reversibility and impact scope
 * - read → local → shared → destructive (escalating levels)
 * - Auto-allow reversible actions, gate irreversible ones
 *
 * Integration with mini-agent's L1/L2/L3 decision model:
 * - L1 (Event Router): read/local → auto-allow
 * - L2 (Task Router): shared → log + allow if within scope
 * - L3 (Consensus): destructive → require explicit claim or hold
 *
 * Key improvement over CC: We also classify LLM tags, not just tools.
 * `<kuro:remember>` is local (write to own memory).
 * `<kuro:chat>` is shared (visible to others).
 * `<kuro:delegate type="code">` is shared (modifies codebase).
 */

import { slog } from './utils.js';
import type { BlastRadius } from './tool-registry.js';

// =============================================================================
// Types
// =============================================================================

export interface ActionClassification {
  /** Original action identifier */
  action: string;
  /** Classified blast radius */
  radius: BlastRadius;
  /** Human-readable reason */
  reason: string;
  /** Whether this action is automatically allowed */
  autoAllow: boolean;
  /** Required confirmation level */
  confirmLevel: 'none' | 'log' | 'claim' | 'hold';
}

// =============================================================================
// Classification Rules
// =============================================================================

/** Static classification rules for known actions */
const STATIC_RULES: Array<{
  pattern: RegExp;
  radius: BlastRadius;
  reason: string;
}> = [
  // === Read (always safe) ===
  { pattern: /^tool:read$/i, radius: 'read', reason: 'File read' },
  { pattern: /^tool:glob$/i, radius: 'read', reason: 'File search' },
  { pattern: /^tool:grep$/i, radius: 'read', reason: 'Content search' },
  { pattern: /^tag:show$/i, radius: 'read', reason: 'Display output' },
  { pattern: /^tag:progress$/i, radius: 'read', reason: 'Progress report' },
  { pattern: /^perception:/i, radius: 'read', reason: 'Perception read' },

  // === Local (reversible, own scope) ===
  { pattern: /^tool:write$/i, radius: 'local', reason: 'File write' },
  { pattern: /^tool:bash$/i, radius: 'local', reason: 'Shell command' },
  { pattern: /^tag:remember$/i, radius: 'local', reason: 'Memory write' },
  { pattern: /^tag:task$/i, radius: 'local', reason: 'Task update' },
  { pattern: /^tag:inner$/i, radius: 'local', reason: 'Inner monologue' },
  { pattern: /^tag:impulse$/i, radius: 'local', reason: 'Creative impulse' },
  { pattern: /^tag:understand$/i, radius: 'local', reason: 'Understanding log' },
  { pattern: /^tag:goal$/i, radius: 'local', reason: 'Goal update' },
  { pattern: /^tag:schedule$/i, radius: 'local', reason: 'Schedule adjustment' },

  // === Shared (visible to others, harder to reverse) ===
  { pattern: /^tool:web-fetch$/i, radius: 'shared', reason: 'HTTP request' },
  { pattern: /^tag:chat$/i, radius: 'shared', reason: 'Chat message (visible to others)' },
  { pattern: /^tag:delegate$/i, radius: 'shared', reason: 'Delegation (spawns subprocess)' },
  { pattern: /^tag:fetch$/i, radius: 'shared', reason: 'URL fetch' },
  { pattern: /^tag:agora$/i, radius: 'shared', reason: 'Agora post (public discussion)' },
  { pattern: /^tag:ask$/i, radius: 'shared', reason: 'Ask user (interrupts human)' },
  { pattern: /^tag:summary$/i, radius: 'shared', reason: 'Summary notification' },

  // === Destructive (hard to reverse, high impact) ===
  { pattern: /^bash:git\s+push/i, radius: 'destructive', reason: 'Git push (shared state)' },
  { pattern: /^bash:git\s+reset\s+--hard/i, radius: 'destructive', reason: 'Git reset (destroys changes)' },
  { pattern: /^bash:rm\s+-rf/i, radius: 'destructive', reason: 'Recursive delete' },
  { pattern: /^bash:npm\s+publish/i, radius: 'destructive', reason: 'Package publish' },
  { pattern: /^telegram:send/i, radius: 'destructive', reason: 'Telegram message (notifies human)' },
];

/** Dynamic classification for bash commands */
const BASH_DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\bgit\s+push\b/,
  /\bgit\s+reset\s+--hard\b/,
  /\bgit\s+branch\s+-[dD]\b/,
  /\bgit\s+checkout\s+--\b/,
  /\brm\s+-rf?\b/,
  /\bnpm\s+publish\b/,
  /\bnpx\s+.*--force\b/,
  /\bdrop\s+table\b/i,
  /\btruncate\s+table\b/i,
  /\bkill\s+-9\b/,
  /\bshutdown\b/,
  /\breboot\b/,
];

const BASH_SHARED_PATTERNS: RegExp[] = [
  /\bcurl\b.*-X\s*(POST|PUT|DELETE|PATCH)/,
  /\bwget\b/,
  /\bnpm\s+(install|uninstall)\b/,
  /\bgit\s+commit\b/,
  /\bgh\s+(pr|issue)\s+create\b/,
  /\bscp\b/,
  /\brsync\b/,
  /\bdocker\s+(push|stop|rm)\b/,
];

// =============================================================================
// Classifier
// =============================================================================

/**
 * Classify an action by its blast radius.
 *
 * @param actionStr - Format: "type:detail" (e.g., "tool:bash", "tag:chat", "bash:git push")
 */
export function classifyAction(actionStr: string): ActionClassification {
  // Try static rules first
  for (const rule of STATIC_RULES) {
    if (rule.pattern.test(actionStr)) {
      return {
        action: actionStr,
        radius: rule.radius,
        reason: rule.reason,
        autoAllow: rule.radius === 'read' || rule.radius === 'local',
        confirmLevel: radiusToConfirmLevel(rule.radius),
      };
    }
  }

  // Dynamic bash command analysis
  if (actionStr.startsWith('bash:')) {
    const cmd = actionStr.slice(5);
    return classifyBashCommand(cmd);
  }

  // Default: local (safe default for unknown actions)
  return {
    action: actionStr,
    radius: 'local',
    reason: 'Unknown action (default: local)',
    autoAllow: true,
    confirmLevel: 'none',
  };
}

/** Classify a bash command specifically */
function classifyBashCommand(cmd: string): ActionClassification {
  // Check destructive patterns
  for (const pattern of BASH_DESTRUCTIVE_PATTERNS) {
    if (pattern.test(cmd)) {
      return {
        action: `bash:${cmd.slice(0, 50)}`,
        radius: 'destructive',
        reason: `Destructive bash command: ${pattern.source}`,
        autoAllow: false,
        confirmLevel: 'hold',
      };
    }
  }

  // Check shared patterns
  for (const pattern of BASH_SHARED_PATTERNS) {
    if (pattern.test(cmd)) {
      return {
        action: `bash:${cmd.slice(0, 50)}`,
        radius: 'shared',
        reason: `Shared-state bash command: ${pattern.source}`,
        autoAllow: false,
        confirmLevel: 'claim',
      };
    }
  }

  // Default bash: local
  return {
    action: `bash:${cmd.slice(0, 50)}`,
    radius: 'local',
    reason: 'Local bash command',
    autoAllow: true,
    confirmLevel: 'none',
  };
}

/** Map radius to confirmation level */
function radiusToConfirmLevel(radius: BlastRadius): 'none' | 'log' | 'claim' | 'hold' {
  switch (radius) {
    case 'read': return 'none';
    case 'local': return 'none';
    case 'shared': return 'claim';
    case 'destructive': return 'hold';
  }
}

// =============================================================================
// Safety Gate
// =============================================================================

/**
 * Safety gate: check if an action should be allowed.
 *
 * Returns true if the action can proceed, false if it should be held.
 * Logs the decision for audit trail.
 */
export function shouldAllow(
  actionStr: string,
  context?: {
    perspective?: string;
    cycleNumber?: number;
    isAutonomous?: boolean;
  },
): { allowed: boolean; classification: ActionClassification } {
  const classification = classifyAction(actionStr);

  // Read and local: always allowed
  if (classification.autoAllow) {
    return { allowed: true, classification };
  }

  // Shared: allowed if primary perspective or has claim
  if (classification.radius === 'shared') {
    const isPrimary = !context?.perspective || context.perspective === 'primary';
    if (isPrimary) {
      return { allowed: true, classification };
    }
    // Non-primary: need claim (handled by consensus.ts)
    return { allowed: false, classification };
  }

  // Destructive: hold for review
  if (classification.radius === 'destructive') {
    slog('BLAST-RADIUS', `HELD: ${actionStr} — ${classification.reason}`);
    return { allowed: false, classification };
  }

  return { allowed: true, classification };
}

/**
 * Batch classify multiple actions.
 * Useful for pre-screening all tags in a cycle before execution.
 */
export function classifyBatch(actions: string[]): ActionClassification[] {
  return actions.map(classifyAction);
}

/**
 * Get the highest blast radius from a batch.
 * Used to determine overall cycle risk level.
 */
export function maxBlastRadius(actions: string[]): BlastRadius {
  const order: BlastRadius[] = ['read', 'local', 'shared', 'destructive'];
  const classifications = classifyBatch(actions);
  let maxIdx = 0;
  for (const c of classifications) {
    const idx = order.indexOf(c.radius);
    if (idx > maxIdx) maxIdx = idx;
  }
  return order[maxIdx];
}
