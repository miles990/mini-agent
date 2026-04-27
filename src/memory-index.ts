/**
 * Memory Index — Unified Relational Index
 *
 * JSONL append-only index. Same-id-last-wins. Replaces:
 * - task-queue.ts (task/goal CRUD)
 * - commitment-gate.ts (commitment detection)
 * - goal-state.ts (already removed)
 *
 * Design: #207/#208 conversation consensus.
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { exec, execSync } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { withFileLock } from './filelock.js';
import { slog, diagLog, tokenizeForMatch } from './utils.js';
import { eventBus } from './event-bus.js';
import { writeMemoryTriple } from './kg-memory.js';
import type { ParsedTags } from './types.js';

// =============================================================================
// Types
// =============================================================================

export type MemoryIndexStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'abandoned'
  | 'hold'
  | 'active'
  | 'inactive'
  | 'failed'
  | 'deleted'
  | string;

export interface MemoryIndexEntry {
  id: string;
  ts: string;
  type: string;
  status: MemoryIndexStatus;
  source?: string;
  topic?: string;
  summary?: string;
  refs: string[];
  tags?: string[];
  payload?: Record<string, unknown>;
}

export interface MemoryIndexQuery {
  id?: string;
  ids?: string[];
  type?: string | string[];
  status?: MemoryIndexStatus | MemoryIndexStatus[];
  source?: string | string[];
  topic?: string | string[];
  refsInclude?: string;
  limit?: number;
}

export interface CreateMemoryIndexEntryInput {
  type: string;
  status: MemoryIndexStatus;
  source?: string;
  topic?: string;
  summary?: string;
  refs?: string[];
  tags?: string[];
  payload?: Record<string, unknown>;
  id?: string;
  ts?: string;
}

export interface VerifyResult {
  name: string;
  status: 'pass' | 'fail' | 'unknown';
  detail?: string;
  updatedAt: string;
}

// =============================================================================
// Constants
// =============================================================================

const INDEX_DIR = 'index';
const INDEX_FILE = 'relations.jsonl';
const TASK_EVENTS_DIR = 'state';
const TASK_EVENTS_FILE = 'task-events.jsonl';
const COMMITMENT_TTL_MS = 24 * 60 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;

// Bucket routing — Phase 3 event split.
// Task events (status transitions) go to state/task-events.jsonl, everything
// else (commitment/goal/remember/…) stays in index/relations.jsonl. Both are
// compiled views (gitignored) — raw truth is the tag stream + entries.jsonl.
type Bucket = 'relations' | 'task-events';

function getBucketForType(type: string): Bucket {
  return type === 'task' ? 'task-events' : 'relations';
}

// Terminal states for tasks/goals — reaching any of these should fire
// commitment resolution against the entry's summary (ghost-commitment fix,
// cycles #46–#50). 'resolved' intentionally excluded: that's a commitment
// status, not a task one.
const TASK_TERMINAL_STATUSES = new Set(['completed', 'done', 'abandoned', 'dropped', 'deleted']);

// Matches first-person future-action commitments. Kept intentionally narrow enough
// to avoid catching questions/references (those are filtered separately in
// extractCommitments), but wide enough to catch the "background work + future cycle"
// class of promises that the 2026-04-07 MemPalace regression exposed.
const COMMITMENT_PATTERN =
  /(?:我來修|我來處理|我馬上|馬上(?:修|做|處理|去)|我現在就|我去做|我會(?:做|寫|整理|給|處理|跟進|回|回覆|修|試|去|補|加|改|上|讀|研究|看|找|查)|我去(?:寫|整理|處理|補|跟進|試|做|修|改|讀|研究|看|找|查|挖)|我來(?:寫|整理|處理|補|跟進|試|做|修|改|讀|研究|看|找|查|挖)|下個\s*cycle|下一個\s*cycle|下一輪|接下來我|背景(?:跑|讀|研究|深讀|挖|深挖)|等一?下我|晚點我|待會(?:我|會)|i['']ll\s+(?:fix|handle|do it|write|check|look|try|build|read|research|investigate|dig)|i will fix)/i;

// =============================================================================
// Helpers
// =============================================================================

function asList<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeId(id: string): string {
  return id.startsWith('idx-') ? id : `idx-${id}`;
}

function toEntryMap(lines: string[]): Map<string, MemoryIndexEntry> {
  const map = new Map<string, MemoryIndexEntry>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const entry = JSON.parse(trimmed) as MemoryIndexEntry;
      if (!entry.id || !entry.type || !entry.status || !Array.isArray(entry.refs)) continue;
      if (entry.status === 'deleted') {
        map.delete(entry.id);
      } else {
        map.set(entry.id, entry);
      }
    } catch {
      // Ignore incomplete/malformed lines (readline safety)
    }
  }
  return map;
}

// =============================================================================
// In-Memory Cache (multi-bucket: relations + task-events)
// =============================================================================

interface BucketCache {
  map: Map<string, MemoryIndexEntry>;
  filePath: string;
  mtimeMs: number;
}

let _caches: Record<Bucket, BucketCache | null> = {
  'relations': null,
  'task-events': null,
};

export function invalidateIndexCache(): void {
  _caches = { 'relations': null, 'task-events': null };
}

function getFileMtime(filePath: string): number {
  try {
    return statSync(filePath).mtimeMs;
  } catch {
    return 0;
  }
}

function getBucketFilePath(memoryDir: string, bucket: Bucket): string {
  if (bucket === 'task-events') {
    return path.join(memoryDir, TASK_EVENTS_DIR, TASK_EVENTS_FILE);
  }
  return path.join(memoryDir, INDEX_DIR, INDEX_FILE);
}

function getCachedBucket(memoryDir: string, bucket: Bucket): Map<string, MemoryIndexEntry> {
  const filePath = getBucketFilePath(memoryDir, bucket);
  const current = _caches[bucket];

  if (current && current.filePath === filePath) {
    const currentMtime = getFileMtime(filePath);
    if (currentMtime === current.mtimeMs) return current.map;
  }

  let raw = '';
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    // File doesn't exist yet
  }
  const map = toEntryMap(raw.split('\n'));
  _caches[bucket] = { map, filePath, mtimeMs: getFileMtime(filePath) };
  return map;
}

/** Merged view across both buckets. Used by all query paths. */
function getCachedMap(memoryDir: string): Map<string, MemoryIndexEntry> {
  const relations = getCachedBucket(memoryDir, 'relations');
  const taskEvents = getCachedBucket(memoryDir, 'task-events');
  if (taskEvents.size === 0) return relations;
  if (relations.size === 0) return taskEvents;
  const merged = new Map<string, MemoryIndexEntry>(relations);
  for (const [k, v] of taskEvents) merged.set(k, v);
  return merged;
}

/** Write-through: update the right bucket's cache without re-reading the file. */
function writeThroughEntry(memoryDir: string, entry: MemoryIndexEntry): void {
  const bucket = getBucketForType(entry.type);
  const cache = _caches[bucket];
  if (!cache) return;
  if (cache.filePath !== getBucketFilePath(memoryDir, bucket)) return;
  if (entry.status === 'deleted') {
    cache.map.delete(entry.id);
  } else {
    cache.map.set(entry.id, entry);
  }
  cache.mtimeMs = getFileMtime(cache.filePath);
}

// =============================================================================
// Path
// =============================================================================

export function getMemoryIndexPath(memoryDir: string): string {
  return path.join(memoryDir, INDEX_DIR, INDEX_FILE);
}

export function getTaskEventsPath(memoryDir: string): string {
  return path.join(memoryDir, TASK_EVENTS_DIR, TASK_EVENTS_FILE);
}

// =============================================================================
// Core: Create / Append
// =============================================================================

export function createMemoryIndexEntry(input: CreateMemoryIndexEntryInput): MemoryIndexEntry {
  return {
    id: normalizeId(input.id ?? randomUUID()),
    ts: input.ts ?? new Date().toISOString(),
    type: input.type,
    status: input.status,
    source: input.source,
    topic: input.topic,
    summary: input.summary,
    refs: input.refs ?? [],
    tags: input.tags,
    payload: input.payload,
  };
}

function ensureBucketFileSync(memoryDir: string, bucket: Bucket): string {
  const filePath = getBucketFilePath(memoryDir, bucket);
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(filePath)) writeFileSync(filePath, '', 'utf-8');
  return filePath;
}

function ensureIndexFileSync(memoryDir: string): string {
  // Pre-warm both buckets so query paths have a file to read from.
  ensureBucketFileSync(memoryDir, 'task-events');
  return ensureBucketFileSync(memoryDir, 'relations');
}

async function ensureBucketFile(memoryDir: string, bucket: Bucket): Promise<string> {
  const filePath = getBucketFilePath(memoryDir, bucket);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  if (!existsSync(filePath)) {
    await fs.writeFile(filePath, '', 'utf-8');
  }
  return filePath;
}

export async function appendMemoryIndexEntry(
  memoryDir: string,
  input: CreateMemoryIndexEntryInput,
): Promise<MemoryIndexEntry> {
  const entry = createMemoryIndexEntry(input);
  const bucket = getBucketForType(entry.type);
  const filePath = await ensureBucketFile(memoryDir, bucket);

  await withFileLock(filePath, async () => {
    await fs.appendFile(filePath, JSON.stringify(entry) + '\n', 'utf-8');
  });

  writeThroughEntry(memoryDir, entry);
  slog('INDEX', `append ${entry.id} type=${entry.type} status=${entry.status} bucket=${bucket}`);
  return entry;
}

// =============================================================================
// Core: Query (sync from cache for hot path)
// =============================================================================

export function queryMemoryIndexSync(
  memoryDir: string,
  query: MemoryIndexQuery = {},
): MemoryIndexEntry[] {
  ensureIndexFileSync(memoryDir);
  const map = getCachedMap(memoryDir);
  const ids = asList(query.ids ?? query.id).map(normalizeId);
  const types = asList(query.type);
  const statuses = asList(query.status);
  const sources = asList(query.source);
  const topics = asList(query.topic);

  let result = [...map.values()];

  if (ids.length > 0) result = result.filter(e => ids.includes(e.id));
  if (types.length > 0) result = result.filter(e => types.includes(e.type));
  if (statuses.length > 0) result = result.filter(e => statuses.includes(e.status));
  if (sources.length > 0) result = result.filter(e => e.source && sources.includes(e.source));
  if (topics.length > 0) result = result.filter(e => e.topic && topics.includes(e.topic));
  if (query.refsInclude) {
    const needle = normalizeId(query.refsInclude);
    result = result.filter(e => e.refs.includes(needle));
  }

  result.sort((a, b) => b.ts.localeCompare(a.ts));
  if (query.limit !== undefined) result = result.slice(0, query.limit);

  return result;
}

// Async version (delegates to sync — cache makes it instant)
export async function queryMemoryIndex(
  memoryDir: string,
  query: MemoryIndexQuery = {},
): Promise<MemoryIndexEntry[]> {
  return queryMemoryIndexSync(memoryDir, query);
}

export async function getRelatedMemoryIndexEntries(
  memoryDir: string,
  id: string,
): Promise<MemoryIndexEntry[]> {
  const results = queryMemoryIndexSync(memoryDir, { id, limit: 1 });
  const target = results[0];
  if (!target || target.refs.length === 0) return [];
  return queryMemoryIndexSync(memoryDir, { ids: target.refs });
}

// =============================================================================
// Update / Delete (append-only — same id last wins)
// =============================================================================

export async function updateMemoryIndexEntry(
  memoryDir: string,
  id: string,
  patch: Partial<Omit<MemoryIndexEntry, 'id'>>,
): Promise<MemoryIndexEntry | null> {
  const normalId = normalizeId(id);
  const current = queryMemoryIndexSync(memoryDir, { id: normalId, limit: 1 })[0];
  if (!current) {
    slog('WARN', `updateMemoryIndexEntry: lookup miss for id=${normalId} — no-op`);
    return null;
  }

  const updated: MemoryIndexEntry = {
    ...current,
    ...patch,
    id: normalId,
    ts: new Date().toISOString(),
    refs: patch.refs ?? current.refs,
  };

  const bucket = getBucketForType(updated.type);
  const filePath = await ensureBucketFile(memoryDir, bucket);
  await withFileLock(filePath, async () => {
    await fs.appendFile(filePath, JSON.stringify(updated) + '\n', 'utf-8');
  });

  writeThroughEntry(memoryDir, updated);
  return updated;
}

export async function deleteMemoryIndexEntry(
  memoryDir: string,
  id: string,
): Promise<boolean> {
  const normalId = normalizeId(id);
  const current = queryMemoryIndexSync(memoryDir, { id: normalId, limit: 1 })[0];
  if (!current) return false;

  const tombstone: MemoryIndexEntry = {
    ...current,
    id: normalId,
    ts: new Date().toISOString(),
    status: 'deleted',
  };

  const bucket = getBucketForType(tombstone.type);
  const filePath = await ensureBucketFile(memoryDir, bucket);
  await withFileLock(filePath, async () => {
    await fs.appendFile(filePath, JSON.stringify(tombstone) + '\n', 'utf-8');
  });

  writeThroughEntry(memoryDir, tombstone);
  return true;
}

// =============================================================================
// Task / Goal CRUD (replaces task-queue.ts)
// =============================================================================

const TASK_REJECT_PATTERNS = [
  /^[^。.!！]*[?？嗎呢]$/,
  /\[mushi\]/i,
  /status changed.*→/i,
  /\[auto\]/i,
  /表達意圖/,
  /^(ok|收到|noted|ack|好的|了解)/i,
  /\[delegate:shell\]/i,
];

function isTaskContentValid(title: string): boolean {
  const trimmed = title.trim();
  if (trimmed.length < 5) return false;
  return !TASK_REJECT_PATTERNS.some(p => p.test(trimmed));
}

export async function createTask(
  memoryDir: string,
  input: {
    type?: 'task' | 'goal';
    title: string;
    status?: string;
    verify?: VerifyResult[];
    origin?: string;
    priority?: number;
    assignee?: string;
    blockedBy?: string[];
    verify_command?: string;
    acceptance_criteria?: string;
    goal_id?: string;
  },
): Promise<MemoryIndexEntry> {
  // Entry filter: reject non-actionable content (except external/manual origin)
  if (input.origin !== 'alex' && input.origin !== 'task-board' && !isTaskContentValid(input.title)) {
    throw new Error(`Task rejected by entry filter: "${input.title.slice(0, 50)}"`);
  }

  const payload: Record<string, unknown> = {};
  if (input.verify) payload.verify = input.verify;
  if (input.origin) payload.origin = input.origin;
  if (input.priority !== undefined) payload.priority = input.priority;
  if (input.assignee) payload.assignee = input.assignee;
  if (input.blockedBy?.length) payload.blockedBy = input.blockedBy;
  if (input.verify_command) payload.verify_command = input.verify_command;
  if (input.acceptance_criteria) payload.acceptance_criteria = input.acceptance_criteria;
  if (input.goal_id) payload.goal_id = input.goal_id;

  const initialStatus = (input.blockedBy?.length) ? 'blocked' : (input.status ?? 'pending');

  return appendMemoryIndexEntry(memoryDir, {
    type: input.type ?? 'task',
    status: initialStatus,
    summary: input.title.trim(),
    payload: Object.keys(payload).length > 0 ? payload : undefined,
  });
}

export async function updateTask(
  memoryDir: string,
  id: string,
  patch: {
    type?: 'task' | 'goal';
    title?: string;
    status?: string;
    verify?: VerifyResult[];
    staleWarning?: string;
    origin?: string;
    priority?: number;
    assignee?: string;
    blockedBy?: string[];
    pinned?: boolean;
    pinContext?: string;
  },
): Promise<MemoryIndexEntry | null> {
  const normalId = normalizeId(id);
  const current = queryMemoryIndexSync(memoryDir, { id: normalId, limit: 1 })[0];
  if (!current) {
    // Observability patch (cycle #99, 2026-04-24): prior 4-cycle silent-failure
    // loop — `updateTask` returned null without log/throw when lookup missed,
    // so emit `op="update" status="abandoned"` for 5 IDs never landed and never
    // surfaced. Converting to loud failure. See diagnosis:
    // memory/reports/2026-04-24-task-queue-update-silent-noop.md
    slog('WARN', `updateTask: lookup miss for id=${normalId} (patch=${JSON.stringify(Object.keys(patch))}) — no-op`);
    return null;
  }

  const prevStatus = current.status;
  const currentPayload = (current.payload ?? {}) as Record<string, unknown>;
  const newPayload: Record<string, unknown> = { ...currentPayload };

  if (patch.verify !== undefined) newPayload.verify = patch.verify;
  if (patch.origin !== undefined) newPayload.origin = patch.origin;
  if (patch.priority !== undefined) newPayload.priority = patch.priority;
  if (patch.assignee !== undefined) newPayload.assignee = patch.assignee;
  if (patch.blockedBy !== undefined) newPayload.blockedBy = patch.blockedBy;
  if (patch.staleWarning !== undefined) {
    newPayload.staleWarning = patch.staleWarning;
  } else if ('staleWarning' in patch) {
    delete newPayload.staleWarning;
  }
  if (patch.pinned !== undefined) newPayload.pinned = patch.pinned;
  if (patch.pinContext !== undefined) newPayload.pinContext = patch.pinContext;
  if (patch.pinned === false) {
    delete newPayload.pinned;
    delete newPayload.pinContext;
  }

  // Progress reset: any status transition or verify write resets staleness counter
  if (patch.status !== undefined && patch.status !== prevStatus) {
    newPayload.ticksSinceLastProgress = 0;
  }
  if (patch.verify !== undefined) {
    newPayload.ticksSinceLastProgress = 0;
  }

  // Verify gate: task with verify_command must pass before terminal status
  const verifyCmd = (currentPayload.verify_command ?? newPayload.verify_command) as string | undefined;
  if (verifyCmd && ['completed', 'done'].includes(patch.status ?? '')) {
    try {
      execSync(verifyCmd, { timeout: 10000, killSignal: 'SIGKILL', stdio: 'pipe', cwd: process.cwd() });
      newPayload.verify_proof = { command: verifyCmd, passed: true, ts: new Date().toISOString() };
    } catch {
      slog('VERIFY-GATE', `Rejected close: verify failed for ${current.summary?.slice(0, 60)}`);
      return current;
    }
  }

  const updated = await updateMemoryIndexEntry(memoryDir, normalId, {
    type: patch.type ?? current.type,
    status: patch.status ?? current.status,
    summary: patch.title ?? current.summary,
    payload: newPayload,
  });

  // Ghost-commitment bridge (cycles #46–#50): when a task/goal transitions
  // into a terminal state, fire the commitment resolver against the entry
  // summary. Previously resolveActiveCommitments only ran on response-token
  // overlap inside detectAndRecordCommitments, so commitments linked to a
  // completed task lingered until the 24h TTL — showing up as "untracked
  // commitments" for cycle after cycle even though the underlying work was
  // already closed out. Only fires on actual transitions to avoid redundant
  // matching when unrelated fields of an already-terminal entry change.
  if (
    updated &&
    updated.status !== prevStatus &&
    (updated.type === 'task' || updated.type === 'goal') &&
    TASK_TERMINAL_STATUSES.has(updated.status) &&
    updated.summary
  ) {
    await resolveActiveCommitments(memoryDir, updated.summary);

    // Fire-and-forget: record terminal transition in KG
    writeMemoryTriple({
      agent: 'kuro',
      predicate: 'decided',
      content: `Task ${updated.status}: ${updated.summary}`,
      importance: 'medium',
      source: 'task-complete',
    });
  }

  // DAG dependency resolver: unlock blocked tasks when this one completes
  if (['completed', 'done'].includes(patch.status ?? '')) {
    resolveDependencies(memoryDir, normalId).catch(() => {});
  }

  return updated;
}

export async function resolveDependencies(memoryDir: string, completedTaskId: string): Promise<number> {
  const allTasks = queryMemoryIndexSync(memoryDir, { type: ['task', 'goal'], status: ['blocked'] });
  let unlocked = 0;
  for (const task of allTasks) {
    const blockedBy = ((task.payload as Record<string, unknown>)?.blockedBy as string[]) ?? [];
    if (blockedBy.includes(completedTaskId)) {
      const remaining = blockedBy.filter(id => id !== completedTaskId);
      if (remaining.length === 0) {
        await updateMemoryIndexEntry(memoryDir, task.id, {
          status: 'pending',
          payload: { ...(task.payload as Record<string, unknown>), blockedBy: [] },
        });
        slog('DAG', `Unlocked: ${task.summary?.slice(0, 60)}`);
        unlocked++;
      } else {
        await updateMemoryIndexEntry(memoryDir, task.id, {
          payload: { ...(task.payload as Record<string, unknown>), blockedBy: remaining },
        });
      }
    }
  }
  // Goal rollup: check if all sibling tasks under same goal are done
  const completedTask = queryMemoryIndexSync(memoryDir, { type: ['task', 'goal'] }).find(t => t.id === completedTaskId);
  const goalId = (completedTask?.payload as Record<string, unknown>)?.goal_id as string;
  if (goalId) {
    const siblings = queryMemoryIndexSync(memoryDir, { type: ['task'] })
      .filter(t => (t.payload as Record<string, unknown>)?.goal_id === goalId);
    const allDone = siblings.every(t => TASK_TERMINAL_STATUSES.has(t.status));
    if (allDone) {
      const goal = queryMemoryIndexSync(memoryDir, { type: ['goal'] }).find(t => t.id === goalId);
      if (goal && !TASK_TERMINAL_STATUSES.has(goal.status)) {
        const goalVerify = (goal.payload as Record<string, unknown>)?.verify_command as string;
        if (goalVerify) {
          try {
            execSync(goalVerify, { timeout: 10000, killSignal: 'SIGKILL', stdio: 'pipe', cwd: process.cwd() });
            await updateMemoryIndexEntry(memoryDir, goalId, {
              status: 'completed',
              payload: { ...(goal.payload as Record<string, unknown>), verify_proof: { command: goalVerify, passed: true, ts: new Date().toISOString() } },
            });
            slog('PIPELINE', `Goal auto-completed: ${goal.summary?.slice(0, 60)}`);
          } catch {
            slog('PIPELINE', `Goal verify failed: ${goal.summary?.slice(0, 60)}`);
          }
        } else {
          await updateMemoryIndexEntry(memoryDir, goalId, { status: 'completed' });
          slog('PIPELINE', `Goal auto-completed (no verify): ${goal.summary?.slice(0, 60)}`);
        }
      }
    }
  }

  return unlocked;
}

export async function createGoal(
  memoryDir: string,
  goal: { title: string; acceptance_criteria: string; verify_command?: string },
  tasks: Array<{ title: string; verify_command?: string; acceptance_criteria?: string; depends_on?: string[] }>,
): Promise<{ goalId: string; taskIds: string[] }> {
  const nameToIdx = new Map(tasks.map((t, i) => [t.title, i]));
  const visited = new Set<number>();
  const stack = new Set<number>();
  function hasCycle(idx: number): boolean {
    if (stack.has(idx)) return true;
    if (visited.has(idx)) return false;
    visited.add(idx); stack.add(idx);
    for (const dep of tasks[idx].depends_on ?? []) {
      const depIdx = nameToIdx.get(dep);
      if (depIdx !== undefined && hasCycle(depIdx)) return true;
    }
    stack.delete(idx);
    return false;
  }
  for (let i = 0; i < tasks.length; i++) {
    if (hasCycle(i)) throw new Error(`Cycle detected in task DAG at: ${tasks[i].title}`);
  }

  const goalEntry = await appendMemoryIndexEntry(memoryDir, {
    type: 'goal',
    status: 'in_progress',
    summary: goal.title,
    payload: { acceptance_criteria: goal.acceptance_criteria, verify_command: goal.verify_command, origin: 'pipeline' },
  });

  const titleToId = new Map<string, string>();
  const taskIds: string[] = [];
  const sorted = [...tasks].sort((a, b) => (a.depends_on?.length ?? 0) - (b.depends_on?.length ?? 0));

  for (const task of sorted) {
    const blockedBy = (task.depends_on ?? []).map(dep => titleToId.get(dep)).filter(Boolean) as string[];
    const entry = await appendMemoryIndexEntry(memoryDir, {
      type: 'task',
      status: blockedBy.length > 0 ? 'blocked' : 'pending',
      summary: task.title,
      payload: {
        verify_command: task.verify_command,
        acceptance_criteria: task.acceptance_criteria,
        goal_id: goalEntry.id,
        blockedBy: blockedBy.length > 0 ? blockedBy : undefined,
        origin: 'pipeline',
      },
    });
    titleToId.set(task.title, entry.id);
    taskIds.push(entry.id);
  }

  return { goalId: goalEntry.id, taskIds };
}

// =============================================================================
// Task Staleness Counter (tick-based drift detection)
// =============================================================================

const STALENESS_THRESHOLD = 3;

/**
 * Increment ticksSinceLastProgress for all pending/in_progress tasks.
 * Called at the end of each OODA cycle (fire-and-forget).
 * Returns tasks that exceed the staleness threshold for surfacing.
 */
export async function incrementTaskStaleness(
  memoryDir: string,
): Promise<Array<{ id: string; summary: string; ticks: number }>> {
  const tasks = queryMemoryIndexSync(memoryDir, {
    type: ['task', 'goal'],
    status: ['pending', 'in_progress'],
  });

  const stale: Array<{ id: string; summary: string; ticks: number }> = [];

  for (const task of tasks) {
    const payload = (task.payload ?? {}) as Record<string, unknown>;
    const currentTicks = (payload.ticksSinceLastProgress as number) ?? 0;
    const newTicks = currentTicks + 1;

    // Auto-abandon: ticks > 20 → garbage, not worth keeping
    if (newTicks > 20) {
      await updateMemoryIndexEntry(memoryDir, task.id, {
        status: 'abandoned',
        payload: { ...payload, ticksSinceLastProgress: newTicks, autoAbandoned: true },
      });
      continue;
    }

    await updateMemoryIndexEntry(memoryDir, task.id, {
      payload: { ...payload, ticksSinceLastProgress: newTicks },
    });

    if (newTicks > STALENESS_THRESHOLD) {
      stale.push({ id: task.id, summary: task.summary ?? task.id, ticks: newTicks });
    }
  }

  return stale;
}

export function findLatestOpenGoal(
  memoryDir: string,
  title: string,
): MemoryIndexEntry | undefined {
  const lowerTitle = title.toLowerCase();
  const goals = queryMemoryIndexSync(memoryDir, {
    type: 'goal',
    status: ['pending', 'in_progress'],
  });

  const matches = goals
    .filter(e => {
      const s = (e.summary ?? '').toLowerCase();
      return s === lowerTitle || s.includes(lowerTitle) || lowerTitle.includes(s);
    })
    .sort((a, b) => b.ts.localeCompare(a.ts));

  return matches[0];
}

// =============================================================================
// Task Queue Context Section (replaces task-queue.ts:buildTaskQueueSection)
// =============================================================================

function markStaleEntries(memoryDir: string): void {
  const nowMs = Date.now();
  const inProgress = queryMemoryIndexSync(memoryDir, {
    type: ['task', 'goal'],
    status: 'in_progress',
  });

  for (const item of inProgress) {
    const age = nowMs - new Date(item.ts).getTime();
    const payload = (item.payload ?? {}) as Record<string, unknown>;
    const hasWarning = !!payload.staleWarning;

    if (age > STALE_MS && !hasWarning) {
      const warning = `stale: in_progress but no update for ${Math.floor(age / 3600000)}h`;
      updateMemoryIndexEntry(memoryDir, item.id, {
        payload: { ...payload, staleWarning: warning },
      }).catch(() => {});
    } else if (age <= STALE_MS && hasWarning) {
      const { staleWarning: _, ...rest } = payload;
      updateMemoryIndexEntry(memoryDir, item.id, {
        payload: rest,
      }).catch(() => {});
    }
  }
}

export function buildTaskQueueSection(memoryDir: string): string {
  markStaleEntries(memoryDir);

  const items = queryMemoryIndexSync(memoryDir, {
    type: ['task', 'goal'],
    status: ['pending', 'in_progress'],
  }).sort((a, b) => {
    if (a.status !== b.status) return a.status === 'in_progress' ? -1 : 1;
    return a.ts.localeCompare(b.ts);
  });

  if (items.length === 0) return '';

  const lines = items.map(item => {
    const payload = (item.payload ?? {}) as Record<string, unknown>;
    const verify = payload.verify as VerifyResult[] | undefined;
    const staleWarning = payload.staleWarning as string | undefined;
    const verifyStr =
      verify && verify.length > 0
        ? `verify: ${verify.slice(-3).map(v => `${v.name}:${v.status}`).join(', ')}`
        : 'verify: (none)';
    const stale = staleWarning ? ` | ⚠ ${staleWarning}` : '';
    return `- [${item.status}] (${item.type}) ${item.summary ?? item.id} | id=${item.id} | ${verifyStr}${stale}`;
  });

  return ['<task-queue>', 'Unified queue (pending + in_progress):', ...lines, '</task-queue>'].join(
    '\n',
  );
}

export function buildTaskQueueSectionCompact(memoryDir: string): string {
  markStaleEntries(memoryDir);

  const items = queryMemoryIndexSync(memoryDir, {
    type: ['task', 'goal'],
    status: ['pending', 'in_progress'],
  }).sort((a, b) => {
    if (a.status !== b.status) return a.status === 'in_progress' ? -1 : 1;
    return a.ts.localeCompare(b.ts);
  });

  if (items.length === 0) return '';

  const lines = items.map(item => {
    const payload = (item.payload ?? {}) as Record<string, unknown>;
    const verify = payload.verify as VerifyResult[] | undefined;
    const staleWarning = payload.staleWarning as string | undefined;

    const summary = (item.summary ?? item.id).slice(0, 80);
    let verifyStr = 'verify: none';
    if (verify && verify.length > 0) {
      const passed = verify.filter(v => v.status === 'pass').length;
      const failed = verify.filter(v => v.status !== 'pass');
      verifyStr = passed === verify.length
        ? `verify: ${passed}/${verify.length} pass`
        : `verify: ${passed}/${verify.length} pass (${failed.map(v => v.name).join(', ')} ✗)`;
    }
    const staleMarker = staleWarning ? ' ⚠' : '';
    return `- [${item.status}] ${summary}${staleMarker} | id=${item.id} | ${verifyStr}`;
  });

  return ['<task-queue>', 'Unified queue (pending + in_progress):', ...lines, '</task-queue>'].join(
    '\n',
  );
}

export function buildPinnedTasksSection(memoryDir: string): string {
  const all = queryMemoryIndexSync(memoryDir, {
    type: ['task', 'goal'],
  });
  const pinned = all.filter(item => {
    const payload = (item.payload ?? {}) as Record<string, unknown>;
    return payload.pinned === true;
  });
  if (pinned.length === 0) return '';

  const lines = pinned.map(item => {
    const payload = (item.payload ?? {}) as Record<string, unknown>;
    const ctx = payload.pinContext as string | undefined;
    const status = item.status;
    const ctxStr = ctx ? ` — ${ctx}` : '';
    return `📌 [${status}] ${item.summary ?? item.id}${ctxStr}`;
  });

  return ['<pinned-tasks>', '持續關注項目（每個 cycle 掃一眼）:', ...lines, '</pinned-tasks>'].join('\n');
}

// =============================================================================
// Commitment Gate (replaces commitment-gate.ts)
// =============================================================================

function extractCommitments(response: string): string[] {
  const plain = response
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]+`/g, ' ')
    .replace(/<\/?kuro:[^>]+>/g, ' ');

  const candidates = plain
    .split(/[\n。！？!?]/)
    .map(s => s.trim())
    .filter(Boolean)
    .filter(s => COMMITMENT_PATTERN.test(s))
    .filter(s => {
      // Exclude questions (asking for permission, not committing)
      if (/嗎|吗|\?$/.test(s)) return false;
      // Exclude permission-seeking patterns (要我..., 要不要我..., 需要我...)
      if (/^(?:\*{0,2})(?:要不要|要|需要|你(?:想|要|需要))我/.test(s)) return false;
      // Exclude markdown headers (section titles label lists, they aren't commitments
      // themselves — ghost-commitments-bug cycles #59–#62: "## 我會做的" repeatedly
      // extracted as a 6-char commitment that could never resolve).
      if (/^#{1,6}\s/.test(s)) return false;
      // Exclude markdown table rows
      if (/^\|.*\|/.test(s) || /\|.*\|$/.test(s)) return false;
      // Exclude quoted/referenced commitments (meta-descriptions, not actual commitments)
      if (/[「」「」]/.test(s)) return false;
      // Exclude lines that describe the commitment system itself — narrowed from
      // bare /commitment|承諾/ which was a binary gate that killed legitimate
      // commitments like "我會遵守承諾" or "I'll write a commitment test".
      // Only exclude compound system terms (gate/tracker/system/detect/etc).
      if (/commitment\s*(?:gate|track|system|detect|extract|record|pattern)/i.test(s) || /承諾(?:追蹤|系統|機制|偵測|紀錄|閘門)/i.test(s)) return false;
      // Exclude checkbox/list items referencing past actions (✅, ~~, completed)
      if (/^[-*]\s*\[x\]|^✅|^~~/.test(s)) return false;
      return true;
    })
    .map(s => s.slice(0, 200));

  return [...new Set(candidates)];
}

export async function detectAndRecordCommitments(
  memoryDir: string,
  response: string,
  _tags: ParsedTags,
): Promise<number> {
  // Always try to resolve matching active commitments — a response fulfills a
  // commitment whenever its content matches, regardless of whether it also
  // spawns tracking tags. Previous gate (hasTrackingTags) required <kuro:task>
  // /<kuro:delegate>/<kuro:goal> etc. to trigger resolve, which meant pure
  // <kuro:chat> responses that actually delivered on a "next cycle give
  // opinion" promise never cleared anything → phantom accumulation observed
  // across cycles #46–#50 (ghost-commitments-bug). Token-overlap threshold
  // (30%, min 1) inside resolveActiveCommitments is the real false-positive
  // guardrail; the gate was a redundant pessimization.
  await resolveActiveCommitments(memoryDir, response);

  const commitments = extractCommitments(response);
  if (commitments.length === 0) return 0;

  const existing = queryMemoryIndexSync(memoryDir, {
    type: 'commitment',
    status: 'active',
  });
  const seen = new Set(
    existing.map(e =>
      (e.summary ?? '')
        .toLowerCase()
        .replace(/[\s\p{P}\p{S}]+/gu, '')
        .trim(),
    ),
  );

  let added = 0;
  for (const text of commitments) {
    const key = text
      .toLowerCase()
      .replace(/[\s\p{P}\p{S}]+/gu, '')
      .trim();
    if (!key || seen.has(key)) continue;

    await appendMemoryIndexEntry(memoryDir, {
      type: 'commitment',
      status: 'active',
      summary: text,
      payload: { expiresAt: new Date(Date.now() + COMMITMENT_TTL_MS).toISOString() },
    });
    seen.add(key);
    added++;
  }

  return added;
}

/**
 * Resolve active commitments that keyword-match the response.
 * Called when tracking tags are present — Kuro converted commitments to tracked execution.
 *
 * Tokenization is CJK-aware (see utils.tokenizeForMatch) so Chinese
 * commitments like "修復承諾追蹤系統" actually share bigrams with responses
 * instead of becoming one unmatchable megatoken. Without this, phantom
 * commitments accumulate forever (observed: cycle #47 leak).
 */
async function resolveActiveCommitments(memoryDir: string, response: string): Promise<void> {
  const active = queryMemoryIndexSync(memoryDir, { type: 'commitment', status: 'active' });
  if (active.length === 0) return;

  const now = Date.now();
  const responseTokens = tokenizeForMatch(response);
  const responseSet = new Set(responseTokens);

  for (const entry of active) {
    // GC: expire commitments past their TTL instead of leaving them "active" forever.
    // buildCommitmentSection already filters by TTL at display time, but without this
    // the JSONL accumulates zombie entries that queryMemoryIndexSync must traverse every cycle.
    const expiresAt = (entry.payload as Record<string, unknown> | undefined)?.expiresAt as string | undefined;
    if (expiresAt && new Date(expiresAt).getTime() <= now) {
      await updateMemoryIndexEntry(memoryDir, entry.id, { status: 'expired' });
      slog('COMMIT', `Expired: "${entry.summary}"`);
      continue;
    }

    const entryTokens = tokenizeForMatch(entry.summary ?? '');
    if (entryTokens.length === 0) continue;

    // Count overlap: exact set membership OR substring match (so "commitment"
    // hits "commitments.ts"). Bigrams make exact match sufficient for CJK.
    const overlap = entryTokens.filter(
      t => responseSet.has(t) || responseTokens.some(r => r.includes(t) || t.includes(r)),
    ).length;

    // Resolve if ≥30% tokens match (min 1 for short commitments)
    if (overlap >= Math.max(1, Math.floor(entryTokens.length * 0.3))) {
      await updateMemoryIndexEntry(memoryDir, entry.id, { status: 'resolved' });
      slog('COMMIT', `Resolved: "${entry.summary}" (${overlap}/${entryTokens.length} tokens matched)`);
    }
  }
}

export function buildCommitmentSection(memoryDir: string): string {
  const now = Date.now();
  const gaps = queryMemoryIndexSync(memoryDir, {
    type: 'commitment',
    status: 'active',
  }).filter(e => {
    const expiresAt = (e.payload as Record<string, unknown> | undefined)?.expiresAt as
      | string
      | undefined;
    if (!expiresAt) return true;
    return new Date(expiresAt).getTime() > now;
  });

  if (gaps.length === 0) return '';

  const lines = gaps.map(g => `- [${g.ts}] ${g.summary}`);
  return `## ${gaps.length} untracked commitment${gaps.length > 1 ? 's' : ''} — convert to action (<kuro:task>, <kuro:delegate>, or <kuro:goal>)\n${lines.join('\n')}`;
}

// =============================================================================
// GC Compact (call via cron — rewrites JSONL keeping only latest per id)
// =============================================================================

export async function compactMemoryIndex(
  memoryDir: string,
): Promise<{ before: number; after: number }> {
  let totalBefore = 0;
  let totalAfter = 0;

  for (const bucket of ['relations', 'task-events'] as Bucket[]) {
    const filePath = await ensureBucketFile(memoryDir, bucket);
    const raw = await fs.readFile(filePath, 'utf-8');
    const lineCount = raw.split('\n').filter(l => l.trim()).length;
    const map = toEntryMap(raw.split('\n'));

    const lines = [...map.values()].map(e => JSON.stringify(e));
    await withFileLock(filePath, async () => {
      await fs.writeFile(filePath, lines.join('\n') + (lines.length > 0 ? '\n' : ''), 'utf-8');
    });

    // Write-through: replace cache with compacted map (no re-read needed)
    _caches[bucket] = { map, filePath, mtimeMs: getFileMtime(filePath) };

    totalBefore += lineCount;
    totalAfter += map.size;
  }

  return { before: totalBefore, after: totalAfter };
}

// =============================================================================
// NEXT.md Replacement — Task Queries & Context Building
// =============================================================================

function getTaskPriority(entry: MemoryIndexEntry): number {
  return ((entry.payload as Record<string, unknown> | undefined)?.priority as number) ?? 2;
}

function getTaskPayload(entry: MemoryIndexEntry): Record<string, unknown> {
  return (entry.payload ?? {}) as Record<string, unknown>;
}

/** Quick check: are there any P0 tasks pending? Used by loop.ts for interval capping and skip guards. */
export function hasP0Tasks(memoryDir: string): boolean {
  const tasks = queryMemoryIndexSync(memoryDir, {
    type: ['task', 'goal'],
    status: ['pending', 'in_progress'],
  });
  return tasks.some(t => getTaskPriority(t) === 0);
}

/** Get pending task preview strings (similar to old extractNextItems output). */
export function getPendingTaskPreviews(memoryDir: string): string[] {
  const tasks = queryMemoryIndexSync(memoryDir, {
    type: ['task', 'goal'],
    status: ['pending', 'in_progress'],
  }).sort((a, b) => getTaskPriority(a) - getTaskPriority(b));

  return tasks.map(t => `- [ ] P${getTaskPriority(t)}: ${t.summary ?? t.id}`);
}

/** Count only P0/P1 pending tasks — P2+ don't block learn/explore/idle */
export function getHighPriorityPendingCount(memDir: string): number {
  const tasks = queryMemoryIndexSync(memDir, {
    type: ['task'],
    status: ['pending', 'in_progress'],
  });
  return tasks.filter(t => getTaskPriority(t) <= 1).length;
}

/** Get P0 task preview strings for priority prefix injection. */
export function getP0TaskPreviews(memoryDir: string): string[] {
  return queryMemoryIndexSync(memoryDir, {
    type: ['task', 'goal'],
    status: ['pending', 'in_progress'],
  })
    .filter(t => getTaskPriority(t) === 0)
    .map(t => `P0: ${t.summary ?? t.id}`);
}

/**
 * Mark tasks done by fuzzy description match.
 * Replaces cycle-tasks.ts markNextItemsDone.
 */
export async function markTaskDoneByDescription(
  memoryDir: string,
  descriptions: string[],
): Promise<number> {
  let totalMarked = 0;

  for (const done of descriptions) {
    const doneNorm = done.toLowerCase().slice(0, 200);
    const tasks = queryMemoryIndexSync(memoryDir, {
      type: ['task', 'goal'],
      status: ['pending', 'in_progress'],
    });

    const matched = tasks.find(task => {
      const summary = (task.summary ?? '').toLowerCase();
      if (!summary) return false;
      // Require longer prefix match (60 chars min) to avoid false positives
      if (summary.length >= 20 && doneNorm.includes(summary.slice(0, 60))) return true;
      const tsMatch = doneNorm.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
      if (tsMatch && summary.includes(tsMatch[0])) return true;
      // Removed: wildcard 'alex' → '回覆 alex' match (caused bulk-marking unrelated reply tasks)
      const doneWords = new Set(doneNorm.match(/[\w\u4e00-\u9fff]{2,}/g) ?? []);
      const summaryWords = summary.match(/[\w\u4e00-\u9fff]{2,}/g) ?? [];
      if (summaryWords.length > 0) {
        const overlap = summaryWords.filter(w => doneWords.has(w)).length;
        if (summaryWords.length >= 3 && overlap / summaryWords.length > 0.85) return true;
      }
      return false;
    });

    if (matched) {
      const updated = await updateMemoryIndexEntry(memoryDir, matched.id, { status: 'completed' });
      if (updated) {
        eventBus.emit('action:task', { content: updated.summary, entry: updated });
        // Ghost-commitment bridge: mirror updateTask's transition handling
        // since this path writes status directly via updateMemoryIndexEntry.
        if (updated.summary) await resolveActiveCommitments(memoryDir, updated.summary);
      }
      slog('DONE', `Marked task done: ${matched.summary?.slice(0, 60)}`);
      totalMarked++;
    }
  }

  return totalMarked;
}

/**
 * Auto-complete reply tasks by roomMsgId.
 * Called when inbox processing confirms a message was replied/addressed.
 * This closes the loop: enqueueRoomDirective creates → inbox replied → task completed.
 */
export async function resolveReplyTasksByRoomMsgId(
  memoryDir: string,
  roomMsgIds: string[],
): Promise<number> {
  let resolved = 0;
  const tasks = queryMemoryIndexSync(memoryDir, {
    type: 'task',
    status: ['pending', 'in_progress'],
  });

  for (const msgId of roomMsgIds) {
    const match = tasks.find(t => (getTaskPayload(t).roomMsgId as string) === msgId);
    if (match) {
      const updated = await updateMemoryIndexEntry(memoryDir, match.id, { status: 'completed' });
      if (updated) {
        eventBus.emit('action:task', { content: updated.summary, entry: updated });
        slog('DONE', `Auto-resolved reply task: ${match.summary?.slice(0, 60)} (msgId=${msgId})`);
        resolved++;
        // Ghost-commitment bridge: inbox-reply tasks are exactly the class
        // of commitment ("下個 cycle 回覆 X") that accumulated as phantoms.
        if (updated.summary) await resolveActiveCommitments(memoryDir, updated.summary);
      }
    }
  }
  return resolved;
}

/**
 * Auto-enqueue Alex's Telegram message as a task.
 * Replaces telegram.ts autoEnqueueToNext.
 */
export async function enqueueAlexMessage(
  memoryDir: string,
  message: string,
  timestamp: string,
  roomMsgId?: string,
): Promise<void> {
  const existing = queryMemoryIndexSync(memoryDir, { type: 'task', source: 'telegram' });
  if (existing.some(e => (getTaskPayload(e).alexTimestamp as string) === timestamp)) return;

  const preview = message.replace(/\n/g, ' ').slice(0, 100);
  const payload: Record<string, unknown> = { priority: 1, alexTimestamp: timestamp, section: 'next' };
  if (roomMsgId) payload.roomMsgId = roomMsgId;
  const entry = await appendMemoryIndexEntry(memoryDir, {
    type: 'task',
    status: 'pending',
    summary: `回覆 Alex: "${preview}"`,
    source: 'telegram',
    payload,
  });
  eventBus.emit('action:task', { content: entry.summary, entry });
  slog('NEXT', `Enqueued: ${preview.slice(0, 40)}`);
}

/**
 * Auto-enqueue Alex's Chat Room message as a tracked task.
 * Ensures conversation directives don't get lost after reply.
 * Mirrors enqueueAlexMessage but for room source.
 */
export async function enqueueRoomDirective(
  memoryDir: string,
  message: string,
  roomMsgId: string,
  from: string,
): Promise<void> {
  // Dedup by roomMsgId
  const existing = queryMemoryIndexSync(memoryDir, { type: 'task', source: 'room' });
  if (existing.some(e => (getTaskPayload(e).roomMsgId as string) === roomMsgId)) return;

  const preview = message.replace(/\n/g, ' ').slice(0, 100);
  const priority = from === 'alex' ? 1 : 2; // Alex = P1, Claude Code = P2
  const entry = await appendMemoryIndexEntry(memoryDir, {
    type: 'task',
    status: 'pending',
    summary: `回覆 ${from}: "${preview}"`,
    source: 'room',
    payload: { priority, roomMsgId, from, section: 'next' },
  });
  eventBus.emit('action:task', { content: entry.summary, entry });
  slog('NEXT', `Enqueued room directive [${from}]: ${preview.slice(0, 40)}`);
}

/**
 * Build <next> context section from memory-index.
 * Replaces memory.ts readNext + extractActiveNext + verifyNextTasks.
 */
export async function buildNextContextSection(
  memoryDir: string,
  options: { minimal?: boolean; runVerify?: boolean } = {},
): Promise<string> {
  const { minimal = false, runVerify = !minimal } = options;

  const tasks = queryMemoryIndexSync(memoryDir, {
    type: ['task', 'goal'],
    status: ['pending', 'in_progress'],
  });
  if (tasks.length === 0) return '';

  const inProgress = tasks.filter(t => t.status === 'in_progress')
    .sort((a, b) => getTaskPriority(a) - getTaskPriority(b));
  const pending = tasks.filter(t => t.status === 'pending')
    .sort((a, b) => getTaskPriority(a) - getTaskPriority(b));

  if (minimal) {
    if (inProgress.length === 0) return '';
    const lines = ['## Now（正在做）', ''];
    for (const t of inProgress) {
      lines.push(`- [ ] P${getTaskPriority(t)}: ${t.summary}`);
    }
    return lines.join('\n');
  }

  const lines: string[] = ['# NEXT', '', '---', ''];

  // Collect all verifyCmds first, run in parallel via Promise.all — previously
  // sequential execSync inside loops blocked the main event loop up to 5s per
  // task (13 tasks × 5s = 65s stalls observed 2026-04-18). Parallel async keeps
  // main thread yielding + compresses total verify time to ~max(single).
  const pendingSlice = pending.slice(0, 10);
  const verifyResults = new Map<string, string>();
  if (runVerify) {
    const uniqueCmds = new Set<string>();
    for (const t of inProgress) {
      const c = getTaskPayload(t).verifyCommand as string | undefined;
      if (c) uniqueCmds.add(c);
    }
    for (const t of pendingSlice) {
      const c = getTaskPayload(t).verifyCommand as string | undefined;
      if (c) uniqueCmds.add(c);
    }
    await Promise.all(Array.from(uniqueCmds).map(async (c) => {
      verifyResults.set(c, await runVerifyCommand(c, memoryDir));
    }));
  }

  if (inProgress.length > 0) {
    lines.push('## Now（正在做）', '');
    for (const t of inProgress) {
      lines.push(`- [ ] P${getTaskPriority(t)}: ${t.summary}`);
      const verifyCmd = getTaskPayload(t).verifyCommand as string | undefined;
      if (verifyCmd) {
        lines.push(`  Verify: \`${verifyCmd}\``);
        if (runVerify) lines.push(`  - **Status: ${verifyResults.get(verifyCmd) ?? '❌ NOT YET'}**`);
      }
    }
    lines.push('', '---', '');
  }

  if (pending.length > 0) {
    lines.push('## Next（按優先度排序）', '');
    for (const t of pendingSlice) {
      lines.push(`- [ ] P${getTaskPriority(t)}: ${t.summary}`);
      const verifyCmd = getTaskPayload(t).verifyCommand as string | undefined;
      if (verifyCmd) {
        lines.push(`  Verify: \`${verifyCmd}\``);
        if (runVerify) lines.push(`  - **Status: ${verifyResults.get(verifyCmd) ?? '❌ NOT YET'}**`);
      }
    }
    lines.push('---');
  }

  return lines.join('\n');
}

async function runVerifyCommand(cmd: string, cwd: string): Promise<string> {
  const cleanCmd = cmd.startsWith('`') && cmd.endsWith('`') ? cmd.slice(1, -1) : cmd;
  try {
    await execAsync(cleanCmd, { cwd, timeout: 5000 });
    return '✅ PASSED';
  } catch {
    return '❌ NOT YET';
  }
}

/** Get task hygiene info for feedback-loops.ts structural health checks. */
export function getTaskHygieneInfo(memoryDir: string): { pendingCount: number; staleCount: number } {
  const tasks = queryMemoryIndexSync(memoryDir, {
    type: ['task', 'goal'],
    status: ['pending', 'in_progress'],
  });
  const fourteenDaysAgo = Date.now() - 14 * 86400_000;
  let staleCount = 0;
  for (const t of tasks) {
    const created = getTaskPayload(t).created as string | undefined;
    if (created) {
      const createdMs = new Date(created).getTime();
      if (!isNaN(createdMs) && createdMs < fourteenDaysAgo && getTaskPriority(t) > 0) staleCount++;
    }
  }
  return { pendingCount: tasks.length, staleCount };
}

/** Get priority keywords from in_progress tasks for alignment checks. */
export function getPriorityKeywords(memoryDir: string): string[] {
  const inProgress = queryMemoryIndexSync(memoryDir, {
    type: ['task', 'goal'],
    status: 'in_progress',
  });
  if (inProgress.length === 0) return [];
  const text = inProgress.map(t => (t.summary ?? '').toLowerCase()).join(' ');
  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'from', 'that', 'this', 'have', 'has',
    'are', 'was', 'were', 'been', 'will', 'would', 'could', 'should',
    'not', 'but', 'all', 'can', 'had', 'her', 'his', 'how', 'its',
    'may', 'new', 'now', 'old', 'our', 'out', 'own', 'say', 'she',
    'too', 'use', 'way', 'who', 'did', 'get', 'let', 'put', 'run',
    'verify', 'grep', 'cat', 'head', 'done', 'todo', 'next', 'check',
  ]);
  const words = text.match(/[a-z\u4e00-\u9fff]{3,}/g) ?? [];
  return [...new Set(words.filter(w => !stopWords.has(w)))].slice(0, 15);
}

/** Get Now task summary for API status endpoint. */
export function getNowTaskSummary(memoryDir: string, maxLen = 150): string {
  const inProgress = queryMemoryIndexSync(memoryDir, {
    type: ['task', 'goal'],
    status: 'in_progress',
  }).sort((a, b) => getTaskPriority(a) - getTaskPriority(b));
  if (inProgress.length === 0) return '';
  const text = inProgress.map(t => `P${getTaskPriority(t)}: ${t.summary}`).join('; ');
  return text.length > maxLen ? text.slice(0, maxLen) + '...' : text;
}

/** Get all tasks snapshot for mode-switch tracking notes. */
export function getTasksSnapshot(memoryDir: string): string {
  return queryMemoryIndexSync(memoryDir, {
    type: ['task', 'goal'],
    status: ['pending', 'in_progress'],
  })
    .sort((a, b) => getTaskPriority(a) - getTaskPriority(b))
    .slice(0, 20)
    .map(t => `- [${t.status === 'in_progress' ? 'x' : ' '}] P${getTaskPriority(t)}: ${t.summary}`)
    .join('\n');
}

/** Decay stale tasks — flag tasks pending too long. P0 never decays. P1 > 7d. P2/P3 > 14d. */
export function auditStaleTasks(memoryDir: string): Array<{ id: string; summary: string; ageDays: number; priority: number }> {
  const tasks = queryMemoryIndexSync(memoryDir, {
    type: ['task', 'goal'],
    status: ['pending', 'in_progress'],
  });
  const now = Date.now();
  const DAY_MS = 86400_000;
  const stale: Array<{ id: string; summary: string; ageDays: number; priority: number }> = [];
  for (const t of tasks) {
    const priority = getTaskPriority(t);
    if (priority === 0) continue;
    const created = getTaskPayload(t).created as string | undefined;
    const createdMs = created ? new Date(created).getTime() : new Date(t.ts).getTime();
    if (isNaN(createdMs)) continue;
    const ageDays = Math.floor((now - createdMs) / DAY_MS);
    const threshold = priority === 1 ? 7 : 14;
    if (ageDays >= threshold) stale.push({ id: t.id, summary: t.summary ?? t.id, ageDays, priority });
  }
  return stale;
}

// =============================================================================
// Compatibility exports (for memory.ts / search.ts call sites)
// =============================================================================

export async function addIndexEntry(
  memoryDir: string,
  content: string,
  topic?: string,
): Promise<void> {
  await appendMemoryIndexEntry(memoryDir, {
    type: 'remember',
    status: 'active',
    topic,
    source: topic ? `topics/${topic}.md` : 'MEMORY.md',
    summary: content.length > 80 ? content.slice(0, 77) + '...' : content,
  });
}

export function isIndexBuilt(memoryDir: string): boolean {
  return existsSync(getMemoryIndexPath(memoryDir));
}

export async function buildMemoryIndex(
  memoryDir: string,
): Promise<{ entries: number; concepts: number }> {
  ensureIndexFileSync(memoryDir);
  const map = getCachedMap(memoryDir);
  return { entries: map.size, concepts: 0 };
}

export async function getManifestContext(memoryDir: string, budget = 2000): Promise<string> {
  // Terminal statuses provide no actionable info — exclude from context budget
  const TERMINAL_STATUSES = new Set(['resolved', 'completed', 'done', 'abandoned', 'dropped', 'deleted']);
  const entries = queryMemoryIndexSync(memoryDir, { limit: 200 })
    .filter(e => !TERMINAL_STATUSES.has(e.status));
  if (entries.length === 0) return '';

  const now = Date.now();
  const lines: string[] = [];
  let used = 0;
  for (const e of entries) {
    // Memory freshness marker (Claude Code pattern: "This memory is N days old")
    const ageDays = Math.floor((now - new Date(e.ts).getTime()) / 86_400_000);
    const freshness = ageDays > 90 ? ' ⚠stale' : ageDays > 30 ? ` ${ageDays}d` : '';
    const line = `- [${e.type}/${e.status}] ${e.topic ?? 'memory'} ${e.summary ?? e.id}${freshness}`;
    if (used + line.length + 1 > budget) break;
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join('\n');
}

export async function getRelevantTopics(
  memoryDir: string,
  query: string,
): Promise<Array<{ topic: string; matchCount: number }>> {
  // Multi-word tokenization: split query into tokens, any token match counts
  const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
  if (tokens.length === 0) return [];

  const counts = new Map<string, number>();

  // Layer 1: FTS5 search (if available) — more accurate than token matching
  try {
    const { searchMemoryEntries, isIndexReady } = await import('./search.js');
    if (isIndexReady()) {
      // Use FTS5 for semantic search — extracts meaningful keywords automatically
      const ftsResults = searchMemoryEntries(memoryDir, query, 30);
      for (const result of ftsResults) {
        // Extract topic name from source path (e.g. "topics/agent-architecture.md" → "agent-architecture")
        const topicMatch = result.source.match(/topics\/([^.]+)\.md$/);
        if (topicMatch) {
          // FTS5 results are ranked by relevance — weight by position
          counts.set(topicMatch[1], (counts.get(topicMatch[1]) ?? 0) + 2);
        }
      }
    }
  } catch { /* FTS5 not available — fall through to index matching */ }

  // Layer 2: Memory index matching (existing logic, enhanced)
  const entries = queryMemoryIndexSync(memoryDir, { limit: 500 });

  for (const e of entries) {
    const summary = (e.summary ?? '').toLowerCase();
    const entryTags = (e.tags ?? []).map(t => t.toLowerCase());
    const entryRefs = e.refs.map(r => r.toLowerCase());

    const matchesAny = tokens.some(t =>
      summary.includes(t) ||
      entryTags.some(tag => tag.includes(t)) ||
      entryRefs.some(ref => ref.includes(t)),
    );

    if (!matchesAny) continue;

    // Direct topic match: entry has a topic field → boost that topic
    if (e.topic) {
      counts.set(e.topic, (counts.get(e.topic) ?? 0) + 1);
    }

    // Cross-topic boosting from direction-change / understanding refs
    // refs like "topic:agent-architecture" boost that topic
    if (e.type === 'direction-change' || e.type === 'understanding') {
      for (const ref of e.refs) {
        const topicRef = ref.match(/^topic:(.+)/);
        if (topicRef) {
          counts.set(topicRef[1], (counts.get(topicRef[1]) ?? 0) + 1);
        }
      }
    }
  }

  return [...counts.entries()]
    .map(([topic, matchCount]) => ({ topic, matchCount }))
    .sort((a, b) => b.matchCount - a.matchCount);
}

/**
 * R6: Get relevant entries (not just topics) for fine-grained context loading.
 * Returns individual memory entries that match the query, with source info.
 * This enables entry-level loading instead of loading entire topic files.
 */
export async function getRelevantEntries(
  memoryDir: string,
  query: string,
  limit = 15,
): Promise<Array<{ topic: string; summary: string; score: number }>> {
  const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length >= 2);
  if (tokens.length === 0) return [];

  const results: Array<{ topic: string; summary: string; score: number }> = [];

  // FTS5 search for content-level matching
  try {
    const { searchMemoryEntries, isIndexReady } = await import('./search.js');
    if (isIndexReady()) {
      const ftsResults = searchMemoryEntries(memoryDir, query, limit);
      for (const r of ftsResults) {
        const topicMatch = r.source.match(/topics\/([^.]+)\.md$/);
        if (topicMatch) {
          results.push({
            topic: topicMatch[1],
            summary: r.content.slice(0, 200),
            score: 2,
          });
        }
      }
    }
  } catch { /* ignore */ }

  // Memory index entries
  const entries = queryMemoryIndexSync(memoryDir, { limit: 200 });
  for (const e of entries) {
    if (!e.topic || !e.summary) continue;
    const summary = e.summary.toLowerCase();
    const matchCount = tokens.filter(t => summary.includes(t)).length;
    if (matchCount > 0) {
      results.push({
        topic: e.topic,
        summary: e.summary,
        score: matchCount,
      });
    }
  }

  // Deduplicate by topic+summary prefix, sort by score
  const seen = new Set<string>();
  return results
    .sort((a, b) => b.score - a.score)
    .filter(r => {
      const key = `${r.topic}:${r.summary.slice(0, 50)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}
