/**
 * Task Graph — Intelligent Task Decomposition & Routing
 *
 * Provides DAG-based task decomposition, dependency detection, merge optimization,
 * and cross-lane routing for mini-agent's multi-lane architecture.
 *
 * All routing is rule-based (zero LLM cost). Pure functions, no external dependencies.
 *
 * Lanes:
 * - ooda (1): Full context (~50K), deep reasoning, perception-aware
 * - foreground (8): Medium context (~15K), DM replies, BatchBuffer 3s
 * - background (6): Minimal context, fire-and-forget delegations
 * - ask (1): Lightweight sync Q&A
 */

import type { InboxItem } from './types.js';

// =============================================================================
// Types
// =============================================================================

/** Execution lane for task routing */
export type TaskLane = 'ooda' | 'foreground' | 'background' | 'ask';

/** Lifecycle status of a task node */
export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'merged';

/** Input for building a task graph */
export interface TaskInput {
  /** Delegation type: code/learn/research/create/review/shell OR 'reply'/'process' */
  type: string;
  /** Task description / prompt */
  prompt: string;
  /** Working directory for the task */
  workdir?: string;
  /** Extracted keywords / topic tags */
  topics?: string[];
  /** Files this task reads or writes */
  files?: string[];
  /** Estimated complexity */
  complexity?: 'low' | 'medium' | 'high';
  /** Explicit lane override (skips auto-routing) */
  lane?: TaskLane;
}

/** A node in the task DAG */
export interface TaskNode {
  /** Unique identifier (e.g. "task-0") */
  id: string;
  /** Delegation type: code/learn/research/create/review/shell OR 'reply'/'process' */
  type: string;
  /** Task description / prompt */
  prompt: string;
  /** Recommended execution lane */
  lane: TaskLane;
  /** Task IDs that must complete before this task can start */
  dependsOn: string[];
  /** If merged, points to the surviving task's ID */
  mergedInto?: string;
  /** Current lifecycle status */
  status: TaskStatus;
  /** Output / result after completion */
  result?: string;
  /** Arbitrary metadata (workdir, topics, files, etc.) */
  metadata?: Record<string, unknown>;
}

/** A wave of tasks that can execute in parallel */
export interface ExecutionWave {
  /** Wave number (0-indexed) */
  wave: number;
  /** Tasks that can run in parallel within this wave */
  tasks: TaskNode[];
}

/** Result of merging related tasks */
export interface MergeResult {
  /** Task IDs that were merged away */
  from: string[];
  /** Surviving task ID */
  into: string;
  /** Human-readable merge reason */
  reason: string;
  /** Combined prompt after merge */
  mergedPrompt: string;
}

/** Complete execution plan derived from a task graph */
export interface ExecutionPlan {
  /** Ordered waves of parallel tasks */
  waves: ExecutionWave[];
  /** Merge operations that were applied */
  merges: MergeResult[];
  /** Total active (non-merged) tasks */
  totalTasks: number;
  /** Maximum concurrent tasks across all waves */
  parallelism: number;
}

/** Routing decision for an inbox item */
export interface RoutingDecision {
  /** The inbox item being routed */
  item: InboxItem;
  /** Target lane */
  lane: 'ooda' | 'foreground';
  /** Human-readable routing reason */
  reason: string;
  /** ID of another item this can be merged with (same sender, same lane) */
  mergeable?: string;
}

// =============================================================================
// Background delegation types (for routeTask lane mapping)
// =============================================================================

const BACKGROUND_TYPES = new Set([
  'code', 'learn', 'research', 'create', 'review', 'shell',
]);

// =============================================================================
// Core Functions
// =============================================================================

/**
 * Build a DAG from a list of task descriptions.
 *
 * Auto-detects dependencies (file conflicts, code->review chains) and
 * merge opportunities (same type + overlapping topics). Returns the full
 * set of TaskNodes with dependency and merge info populated.
 */
export function buildTaskGraph(tasks: TaskInput[]): TaskNode[] {
  const nodes: TaskNode[] = tasks.map((t, i) => ({
    id: `task-${i}`,
    type: t.type,
    prompt: t.prompt,
    lane: t.lane ?? routeTaskToLane(t),
    dependsOn: [],
    status: 'pending' as TaskStatus,
    metadata: {
      ...(t.workdir ? { workdir: t.workdir } : {}),
      ...(t.topics ? { topics: t.topics } : {}),
      ...(t.files ? { files: t.files } : {}),
      ...(t.complexity ? { complexity: t.complexity } : {}),
    },
  }));

  detectDependencies(nodes);
  const merges = detectMerges(nodes);

  for (const merge of merges) {
    for (const fromId of merge.from) {
      const node = nodes.find(n => n.id === fromId);
      if (node) {
        node.status = 'merged';
        node.mergedInto = merge.into;
      }
    }
  }

  return nodes;
}

/**
 * Detect implicit dependencies between tasks (mutates task nodes in place).
 *
 * Rules (zero LLM cost):
 * - code -> review: if they share files or review prompt references code work
 * - code -> code: same-file write conflict serializes later task
 * - create -> code: if code prompt mentions generated/template content
 */
export function detectDependencies(tasks: TaskNode[]): void {
  for (let i = 0; i < tasks.length; i++) {
    for (let j = 0; j < tasks.length; j++) {
      if (i === j) continue;
      const a = tasks[i];
      const b = tasks[j];

      const aFiles = (a.metadata?.files as string[] | undefined) ?? [];
      const bFiles = (b.metadata?.files as string[] | undefined) ?? [];
      const hasFileOverlap = aFiles.length > 0 && bFiles.length > 0 &&
        aFiles.some(f => bFiles.includes(f));

      // code -> review: implicit dependency when sharing files or review references code
      if (a.type === 'code' && b.type === 'review') {
        if (hasFileOverlap || b.prompt.toLowerCase().includes(a.type)) {
          if (!b.dependsOn.includes(a.id)) {
            b.dependsOn.push(a.id);
          }
        }
      }

      // code -> code: same-file write conflict — serialize (earlier first)
      if (a.type === 'code' && b.type === 'code' && i < j) {
        if (hasFileOverlap) {
          if (!b.dependsOn.includes(a.id)) {
            b.dependsOn.push(a.id);
          }
        }
      }

      // create -> code: if code depends on generated content
      if (a.type === 'create' && b.type === 'code' && i < j) {
        const bLower = b.prompt.toLowerCase();
        if (bLower.includes('generated') || bLower.includes('template')) {
          if (!b.dependsOn.includes(a.id)) {
            b.dependsOn.push(a.id);
          }
        }
      }
    }
  }
}

/**
 * Detect and merge related tasks.
 *
 * Tasks of the same type with >= 2 overlapping topics are merged.
 * The earlier task survives; its prompt is extended with the merged task's content.
 */
export function detectMerges(tasks: TaskNode[]): MergeResult[] {
  const merges: MergeResult[] = [];
  const active = tasks.filter(t => t.status === 'pending');

  // Group by type
  const byType = new Map<string, TaskNode[]>();
  for (const t of active) {
    const group = byType.get(t.type) ?? [];
    group.push(t);
    byType.set(t.type, group);
  }

  for (const [type, group] of byType) {
    if (group.length < 2) continue;

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (a.status === 'merged' || b.status === 'merged') continue;

        const aTopics = (a.metadata?.topics as string[] | undefined) ?? extractTopics(a.prompt);
        const bTopics = (b.metadata?.topics as string[] | undefined) ?? extractTopics(b.prompt);
        const overlap = aTopics.filter(t => bTopics.includes(t));

        if (overlap.length >= 2) {
          const mergedPrompt = `${a.prompt}\n\nAdditionally: ${b.prompt}`;
          merges.push({
            from: [b.id],
            into: a.id,
            reason: `same type (${type}) + ${overlap.length} shared topics: ${overlap.join(', ')}`,
            mergedPrompt,
          });
          // Update surviving task's prompt
          a.prompt = mergedPrompt;
          // Mark b as merged so it won't be merged again in this loop
          b.status = 'merged';
          b.mergedInto = a.id;
        }
      }
    }
  }

  return merges;
}

/**
 * Generate an execution plan (waves of parallel tasks) from a task graph.
 *
 * Uses topological sort to group tasks into waves. Tasks within the same wave
 * have all dependencies satisfied and can run concurrently. Handles circular
 * dependencies by force-breaking on the first undone task.
 */
export function planExecution(tasks: TaskNode[]): ExecutionPlan {
  const active = tasks.filter(t => t.status !== 'merged');
  const done = new Set<string>();
  const waves: ExecutionWave[] = [];
  let waveNum = 0;

  while (done.size < active.length) {
    // Find tasks whose dependencies are all satisfied
    const ready = active.filter(t =>
      !done.has(t.id) &&
      t.dependsOn.every(dep => done.has(dep)),
    );

    if (ready.length === 0) {
      // Circular dependency — force break by picking first undone task
      const stuck = active.find(t => !done.has(t.id));
      if (stuck) {
        waves.push({ wave: waveNum++, tasks: [stuck] });
        done.add(stuck.id);
      } else {
        break;
      }
      continue;
    }

    waves.push({ wave: waveNum++, tasks: ready });
    for (const t of ready) done.add(t.id);
  }

  const maxParallel = waves.length > 0
    ? Math.max(...waves.map(w => w.tasks.length))
    : 0;

  return {
    waves,
    merges: [], // caller fills from detectMerges result
    totalTasks: active.length,
    parallelism: maxParallel,
  };
}

/**
 * Route a single task to the best lane based on its characteristics.
 *
 * Rule-based, zero LLM cost:
 * - Background delegation types (code/learn/research/create/review/shell) -> background
 * - Reply type: high complexity or long prompt -> ooda, else foreground
 * - Process type: low complexity -> foreground, else ooda
 * - Default -> ooda
 */
export function routeTaskToLane(task: TaskInput): TaskLane {
  const { type, complexity, prompt } = task;

  // Explicit delegation types -> background
  if (BACKGROUND_TYPES.has(type)) {
    return 'background';
  }

  // Reply to DM
  if (type === 'reply') {
    // Complex replies need OODA depth
    if (complexity === 'high' || prompt.length > 1000) {
      return 'ooda';
    }
    return 'foreground';
  }

  // Process/analyze tasks
  if (type === 'process') {
    if (complexity === 'low') return 'foreground';
    return 'ooda';
  }

  // Default
  return 'ooda';
}

/**
 * Route inbox items: split independent DMs to foreground, keep complex ones for OODA.
 *
 * Heuristics (zero LLM cost):
 * - Short simple messages -> foreground
 * - Direct questions (ending with ?) -> foreground
 * - Technical/code content -> ooda (needs deep context)
 * - Multi-part numbered requests -> ooda
 * - Consecutive messages from same sender in same lane -> mergeable
 */
export function routeInboxItems(items: InboxItem[]): RoutingDecision[] {
  const decisions: RoutingDecision[] = [];

  for (const item of items) {
    const text = item.content;

    // Short simple messages -> foreground
    const isSimple = text.length < 200 && !text.includes('```');
    // Questions (ending with ?) -> foreground
    const isQuestion = text.trim().endsWith('?');
    // Technical/code discussion -> OODA (needs deep context)
    const isTechnical = /```|function|class|import|src\/|bug|error|refactor/i.test(text);
    // Multi-part request -> OODA
    const isMultiPart = (text.match(/\d+\./g) ?? []).length >= 3;

    let lane: 'ooda' | 'foreground';
    let reason: string;

    if (isTechnical || isMultiPart) {
      lane = 'ooda';
      reason = isTechnical ? 'technical content needs deep context' : 'multi-part request';
    } else if (isSimple || isQuestion) {
      lane = 'foreground';
      reason = isSimple ? 'simple message' : 'direct question';
    } else {
      lane = 'foreground';
      reason = 'default: foreground for DMs';
    }

    // Check for mergeable items (same source + sender in same lane)
    const sameSrc = decisions.filter(d =>
      d.item.source === item.source && d.lane === lane,
    );
    if (sameSrc.length > 0) {
      const last = sameSrc[sameSrc.length - 1];
      if (last.item.from === item.from) {
        decisions.push({ item, lane, reason, mergeable: last.item.id });
        continue;
      }
    }

    decisions.push({ item, lane, reason });
  }

  return decisions;
}

// =============================================================================
// Helpers (internal)
// =============================================================================

/**
 * Simple keyword extraction from a prompt (no LLM).
 *
 * Extracts: quoted terms, file paths, and technical terms (capitalized/hyphenated).
 */
export function extractTopics(prompt: string): string[] {
  const text = prompt.toLowerCase();
  const topics: string[] = [];

  // Extract quoted terms
  const quoted = text.match(/"([^"]+)"/g) ?? [];
  topics.push(...quoted.map(q => q.replace(/"/g, '')));

  // Extract file paths (e.g. src/loop.ts, plugins/foo.sh)
  const paths = text.match(/\b[\w/-]+\.\w{1,5}\b/g) ?? [];
  topics.push(...paths);

  // Extract technical terms (capitalized words, hyphenated terms) from original prompt
  const terms = prompt.match(/\b[A-Z][a-zA-Z]+(?:-[a-zA-Z]+)*\b/g) ?? [];
  topics.push(...terms.map(t => t.toLowerCase()));

  // Deduplicate
  return [...new Set(topics)];
}
