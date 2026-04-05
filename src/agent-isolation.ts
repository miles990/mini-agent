/**
 * Agent Isolation — Fresh Context + File-Based Handoff
 *
 * Inspired by Claude Code's sub-agent architecture:
 * - Each sub-agent gets a fresh context (no parent pollution)
 * - Results passed back via file-based handoff (not shared memory)
 * - Agent lifecycle tracked in structured JSONL
 * - Tool access scoped per agent type
 *
 * Key difference from CC: CC sub-agents are within one process.
 * Our delegations are actual subprocesses. So we use file handoff:
 *
 *   Primary → writes task.json → spawns subprocess
 *   Subprocess → reads task.json → works → writes result.json
 *   Primary → reads result.json → integrates
 *
 * The isolation prevents:
 * 1. Context window pollution (sub-agent tokens don't eat parent's budget)
 * 2. Memory contamination (sub-agent can't write parent's memory)
 * 3. Tool permission escalation (scoped tool access)
 */

import fs from 'node:fs';
import path from 'node:path';
import { getInstanceDir, getCurrentInstanceId } from './instance.js';
import { slog } from './utils.js';
import { eventBus } from './event-bus.js';
import type { DelegationTaskType, Provider } from './types.js';

// =============================================================================
// Types
// =============================================================================

/** Isolated agent task specification — written to task.json */
export interface IsolatedTaskSpec {
  id: string;
  type: DelegationTaskType;
  provider: Provider;
  prompt: string;
  workdir: string;
  /** Scoped context: only what the sub-agent needs */
  context: IsolatedContext;
  /** Allowed tools (from tool-registry) */
  allowedTools: string[];
  /** Constraints */
  maxTurns: number;
  timeoutMs: number;
  /** Verification commands to run after completion */
  verify?: string[];
  createdAt: string;
}

/** Minimal context for isolated sub-agent */
export interface IsolatedContext {
  /** Task-specific instructions */
  instructions: string;
  /** Relevant file paths (sub-agent can read these) */
  relevantFiles?: string[];
  /** Key facts the sub-agent needs to know */
  facts?: string[];
  /** Active decisions that apply to this task */
  activeDecisions?: string[];
  /** Rules that apply based on workdir files */
  rules?: string[];
}

/** Sub-agent result — written to result.json */
export interface IsolatedTaskResult {
  id: string;
  status: 'completed' | 'failed' | 'timeout';
  output: string;
  /** Files created or modified */
  filesChanged?: string[];
  /** Verification results */
  verifyResults?: Array<{ cmd: string; passed: boolean; output: string }>;
  /** Self-assessed confidence (1-10) */
  confidence?: number;
  /** Duration in ms */
  durationMs: number;
  completedAt: string;
}

/** Agent lifecycle event for JSONL tracking */
export interface AgentLifecycleEvent {
  id: string;
  event: 'start' | 'progress' | 'complete' | 'fail' | 'timeout';
  taskType: DelegationTaskType;
  timestamp: string;
  data: Record<string, unknown>;
}

// =============================================================================
// Handoff Directory Management
// =============================================================================

const HANDOFF_DIR = 'handoff';

/** Get handoff directory for a specific task */
export function getHandoffDir(taskId: string): string {
  const instanceDir = getInstanceDir(getCurrentInstanceId());
  const dir = path.join(instanceDir, HANDOFF_DIR, taskId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/** Write task spec to handoff directory */
export function writeTaskSpec(spec: IsolatedTaskSpec): string {
  const dir = getHandoffDir(spec.id);
  const filePath = path.join(dir, 'task.json');
  fs.writeFileSync(filePath, JSON.stringify(spec, null, 2), 'utf-8');
  return filePath;
}

/** Read task spec from handoff directory */
export function readTaskSpec(taskId: string): IsolatedTaskSpec | null {
  const filePath = path.join(getHandoffDir(taskId), 'task.json');
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/** Write task result to handoff directory */
export function writeTaskResult(result: IsolatedTaskResult): string {
  const dir = getHandoffDir(result.id);
  const filePath = path.join(dir, 'result.json');
  fs.writeFileSync(filePath, JSON.stringify(result, null, 2), 'utf-8');
  return filePath;
}

/** Read task result from handoff directory */
export function readTaskResult(taskId: string): IsolatedTaskResult | null {
  const filePath = path.join(getHandoffDir(taskId), 'result.json');
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

/** Append progress log to handoff directory */
export function appendProgressLog(taskId: string, line: string): void {
  const filePath = path.join(getHandoffDir(taskId), 'progress.log');
  fs.appendFileSync(filePath, `${new Date().toISOString()} ${line}\n`, 'utf-8');
}

// =============================================================================
// Isolated Context Builder
// =============================================================================

/**
 * Build minimal context for a sub-agent.
 * Only includes what it needs — no SOUL, no memory, no full heartbeat.
 */
export function buildIsolatedContext(opts: {
  prompt: string;
  type: DelegationTaskType;
  workdir: string;
  activeDecisions?: string[];
  relevantFiles?: string[];
  facts?: string[];
}): IsolatedContext {
  const context: IsolatedContext = {
    instructions: buildInstructions(opts.type, opts.prompt),
  };

  if (opts.relevantFiles?.length) {
    context.relevantFiles = opts.relevantFiles;
  }

  if (opts.facts?.length) {
    context.facts = opts.facts;
  }

  if (opts.activeDecisions?.length) {
    context.activeDecisions = opts.activeDecisions;
  }

  return context;
}

/** Build type-specific instructions for the sub-agent */
function buildInstructions(type: DelegationTaskType, prompt: string): string {
  const preambles: Record<DelegationTaskType, string> = {
    code: 'You are a focused coding agent. Write clean, tested code. Report what you changed.',
    learn: 'You are a research agent. Find information, summarize key findings. Be concise.',
    research: 'You are a deep research agent. Explore thoroughly, cite sources, identify patterns.',
    create: 'You are a creative agent. Produce polished output following the given specifications.',
    review: 'You are a code review agent. Check for bugs, style issues, and improvements.',
    shell: 'Execute the given shell command and report results.',
    browse: 'You are a browser agent. Navigate, interact, and extract information from web pages.',
    akari: 'You are Akari, a decision-support agent. Analyze options and recommend the best path.',
  };

  return `${preambles[type] ?? 'Complete the following task.'}\n\n${prompt}`;
}

// =============================================================================
// Lifecycle Tracking
// =============================================================================

const LIFECYCLE_FILE = 'agent-lifecycle.jsonl';

/** Log an agent lifecycle event */
export function logAgentLifecycle(event: AgentLifecycleEvent): void {
  try {
    const instanceDir = getInstanceDir(getCurrentInstanceId());
    const filePath = path.join(instanceDir, LIFECYCLE_FILE);
    const line = JSON.stringify(event) + '\n';
    fs.appendFileSync(filePath, line, 'utf-8');

    // Also emit to event bus
    eventBus.emit(
      event.event === 'start' ? 'action:delegation-start' : 'action:delegation-complete',
      { ...event },
    );
  } catch {
    // Non-critical
  }
}

/** Get recent lifecycle events */
export function getRecentLifecycleEvents(limit = 50): AgentLifecycleEvent[] {
  try {
    const instanceDir = getInstanceDir(getCurrentInstanceId());
    const filePath = path.join(instanceDir, LIFECYCLE_FILE);
    if (!fs.existsSync(filePath)) return [];

    const lines = fs.readFileSync(filePath, 'utf-8').trim().split('\n');
    return lines
      .slice(-limit)
      .map(line => {
        try { return JSON.parse(line); } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Get lifecycle summary (for observability) */
export function getLifecycleSummary(): {
  running: number;
  completed: number;
  failed: number;
  avgDurationMs: number;
} {
  const events = getRecentLifecycleEvents(200);
  const starts = new Set(events.filter(e => e.event === 'start').map(e => e.id));
  const completions = events.filter(e => e.event === 'complete');
  const failures = events.filter(e => e.event === 'fail' || e.event === 'timeout');
  const completedIds = new Set([...completions, ...failures].map(e => e.id));

  const running = [...starts].filter(id => !completedIds.has(id)).length;
  const durations = completions
    .map(e => e.data.durationMs as number)
    .filter(d => typeof d === 'number');
  const avgDurationMs = durations.length > 0
    ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
    : 0;

  return {
    running,
    completed: completions.length,
    failed: failures.length,
    avgDurationMs,
  };
}

// =============================================================================
// Cleanup
// =============================================================================

/** Clean up old handoff directories (older than 1 hour) */
export function cleanupHandoff(maxAgeMs = 3600_000): number {
  let cleaned = 0;
  try {
    const instanceDir = getInstanceDir(getCurrentInstanceId());
    const handoffBase = path.join(instanceDir, HANDOFF_DIR);
    if (!fs.existsSync(handoffBase)) return 0;

    const entries = fs.readdirSync(handoffBase);
    const now = Date.now();

    for (const entry of entries) {
      const fullPath = path.join(handoffBase, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory() && now - stat.mtimeMs > maxAgeMs) {
          fs.rmSync(fullPath, { recursive: true });
          cleaned++;
        }
      } catch {
        // Skip
      }
    }
  } catch {
    // Non-critical
  }

  if (cleaned > 0) {
    slog('HANDOFF', `Cleaned ${cleaned} old handoff directories`);
  }
  return cleaned;
}

/**
 * Format isolated context as a system prompt for the sub-agent.
 * This is what gets passed to the Claude CLI subprocess.
 */
export function formatIsolatedPrompt(spec: IsolatedTaskSpec): string {
  const parts: string[] = [];

  parts.push(spec.context.instructions);

  if (spec.context.facts?.length) {
    parts.push('\n## Key Facts');
    for (const fact of spec.context.facts) {
      parts.push(`- ${fact}`);
    }
  }

  if (spec.context.relevantFiles?.length) {
    parts.push('\n## Relevant Files');
    for (const file of spec.context.relevantFiles) {
      parts.push(`- ${file}`);
    }
  }

  if (spec.context.activeDecisions?.length) {
    parts.push('\n## Active Decisions');
    for (const decision of spec.context.activeDecisions) {
      parts.push(`- ${decision}`);
    }
  }

  if (spec.context.rules?.length) {
    parts.push('\n## Rules');
    for (const rule of spec.context.rules) {
      parts.push(`- ${rule}`);
    }
  }

  if (spec.verify?.length) {
    parts.push(`\n## Verification\nAfter completing, run these commands to verify:\n${spec.verify.map(v => `- \`${v}\``).join('\n')}`);
  }

  parts.push(`\nWorking directory: ${spec.workdir}`);
  parts.push(`Allowed tools: ${spec.allowedTools.join(', ')}`);
  parts.push(`Max turns: ${spec.maxTurns}`);

  return parts.join('\n');
}
