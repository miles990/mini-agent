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

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { withFileLock } from './filelock.js';
import { slog, diagLog } from './utils.js';
import { eventBus } from './event-bus.js';
import type { ParsedTags } from './types.js';

// =============================================================================
// Types
// =============================================================================

export type MemoryIndexStatus =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'abandoned'
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
const COMMITMENT_TTL_MS = 24 * 60 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;

const COMMITMENT_PATTERN =
  /(?:我來修|我來處理|我馬上|馬上(?:修|做|處理|去)|我現在就|我去做|i['']ll fix|i will fix|i['']ll handle|i['']ll do it)/i;

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
// In-Memory Cache
// =============================================================================

let _cache: { map: Map<string, MemoryIndexEntry>; filePath: string } | null = null;

export function invalidateIndexCache(): void {
  _cache = null;
}

function getCachedMap(memoryDir: string): Map<string, MemoryIndexEntry> {
  const filePath = getMemoryIndexPath(memoryDir);
  if (_cache && _cache.filePath === filePath) return _cache.map;

  let raw = '';
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch {
    // File doesn't exist yet
  }
  const map = toEntryMap(raw.split('\n'));
  _cache = { map, filePath };
  return map;
}

/** Write-through: update in-memory cache without re-reading the file. */
function writeThroughEntry(memoryDir: string, entry: MemoryIndexEntry): void {
  if (!_cache || _cache.filePath !== getMemoryIndexPath(memoryDir)) return;
  if (entry.status === 'deleted') {
    _cache.map.delete(entry.id);
  } else {
    _cache.map.set(entry.id, entry);
  }
}

// =============================================================================
// Path
// =============================================================================

export function getMemoryIndexPath(memoryDir: string): string {
  return path.join(memoryDir, INDEX_DIR, INDEX_FILE);
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

function ensureIndexFileSync(memoryDir: string): string {
  const filePath = getMemoryIndexPath(memoryDir);
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(filePath)) writeFileSync(filePath, '', 'utf-8');
  return filePath;
}

async function ensureIndexFile(memoryDir: string): Promise<string> {
  const filePath = getMemoryIndexPath(memoryDir);
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
  const filePath = await ensureIndexFile(memoryDir);

  await withFileLock(filePath, async () => {
    await fs.appendFile(filePath, JSON.stringify(entry) + '\n', 'utf-8');
  });

  writeThroughEntry(memoryDir, entry);
  slog('INDEX', `append ${entry.id} type=${entry.type} status=${entry.status}`);
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
  if (!current) return null;

  const updated: MemoryIndexEntry = {
    ...current,
    ...patch,
    id: normalId,
    ts: new Date().toISOString(),
    refs: patch.refs ?? current.refs,
  };

  const filePath = await ensureIndexFile(memoryDir);
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

  const filePath = await ensureIndexFile(memoryDir);
  await withFileLock(filePath, async () => {
    await fs.appendFile(filePath, JSON.stringify(tombstone) + '\n', 'utf-8');
  });

  writeThroughEntry(memoryDir, tombstone);
  return true;
}

// =============================================================================
// Task / Goal CRUD (replaces task-queue.ts)
// =============================================================================

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
  },
): Promise<MemoryIndexEntry> {
  const payload: Record<string, unknown> = {};
  if (input.verify) payload.verify = input.verify;
  if (input.origin) payload.origin = input.origin;
  if (input.priority !== undefined) payload.priority = input.priority;
  if (input.assignee) payload.assignee = input.assignee;
  if (input.blockedBy?.length) payload.blockedBy = input.blockedBy;

  return appendMemoryIndexEntry(memoryDir, {
    type: input.type ?? 'task',
    status: input.status ?? 'pending',
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
  if (!current) return null;

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

  return updateMemoryIndexEntry(memoryDir, normalId, {
    type: patch.type ?? current.type,
    status: patch.status ?? current.status,
    summary: patch.title ?? current.summary,
    payload: newPayload,
  });
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
    return `- [${item.status}] (${item.type}) ${item.summary ?? item.id} | ${verifyStr}${stale}`;
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

function hasTrackingTags(tags: ParsedTags): boolean {
  return Boolean(
    tags.tasks.length > 0 ||
      tags.delegates.length > 0 ||
      tags.progresses.length > 0 ||
      tags.goal ||
      tags.goalQueue ||
      tags.goalAdvance ||
      tags.goalProgress ||
      tags.goalDone ||
      tags.goalAbandon ||
      tags.taskQueueActions.length > 0,
  );
}

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
    .map(s => s.slice(0, 200));

  return [...new Set(candidates)];
}

export async function detectAndRecordCommitments(
  memoryDir: string,
  response: string,
  tags: ParsedTags,
): Promise<number> {
  // When tracking tags present, resolve matching active commitments instead of creating new ones
  if (hasTrackingTags(tags)) {
    await resolveActiveCommitments(memoryDir, response);
    return 0;
  }

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
 */
async function resolveActiveCommitments(memoryDir: string, response: string): Promise<void> {
  const active = queryMemoryIndexSync(memoryDir, { type: 'commitment', status: 'active' });
  if (active.length === 0) return;

  const responseWords = new Set(
    response.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ' ').split(' ').filter(w => w.length > 1),
  );

  for (const entry of active) {
    const words = (entry.summary ?? '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, ' ').split(' ').filter(w => w.length > 1);
    if (words.length === 0) continue;
    const overlap = words.filter(w => responseWords.has(w)).length;
    // Resolve if ≥30% keywords match (min 1 for short commitments)
    if (overlap >= Math.max(1, Math.floor(words.length * 0.3))) {
      await updateMemoryIndexEntry(memoryDir, entry.id, { status: 'resolved' });
      slog('COMMIT', `Resolved: "${entry.summary}" (${overlap}/${words.length} keywords matched)`);
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
  const filePath = await ensureIndexFile(memoryDir);
  const raw = await fs.readFile(filePath, 'utf-8');
  const lineCount = raw.split('\n').filter(l => l.trim()).length;
  const map = toEntryMap(raw.split('\n'));

  const lines = [...map.values()].map(e => JSON.stringify(e));
  await withFileLock(filePath, async () => {
    await fs.writeFile(filePath, lines.join('\n') + (lines.length > 0 ? '\n' : ''), 'utf-8');
  });

  // Write-through: replace cache with compacted map (no re-read needed)
  _cache = { map, filePath };
  return { before: lineCount, after: map.size };
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
      if (doneNorm.includes(summary.slice(0, 40)) || summary.includes(doneNorm.slice(0, 40))) return true;
      const tsMatch = doneNorm.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
      if (tsMatch && summary.includes(tsMatch[0])) return true;
      // Removed: wildcard 'alex' → '回覆 alex' match (caused bulk-marking unrelated reply tasks)
      const doneWords = new Set(doneNorm.match(/[\w\u4e00-\u9fff]{2,}/g) ?? []);
      const summaryWords = summary.match(/[\w\u4e00-\u9fff]{2,}/g) ?? [];
      if (summaryWords.length > 0) {
        const overlap = summaryWords.filter(w => doneWords.has(w)).length;
        if (overlap / summaryWords.length > 0.6) return true;
      }
      return false;
    });

    if (matched) {
      const updated = await updateMemoryIndexEntry(memoryDir, matched.id, { status: 'completed' });
      if (updated) eventBus.emit('action:task', { content: updated.summary, entry: updated });
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

  if (inProgress.length > 0) {
    lines.push('## Now（正在做）', '');
    for (const t of inProgress) {
      lines.push(`- [ ] P${getTaskPriority(t)}: ${t.summary}`);
      const verifyCmd = getTaskPayload(t).verifyCommand as string | undefined;
      if (verifyCmd) {
        lines.push(`  Verify: \`${verifyCmd}\``);
        if (runVerify) lines.push(`  - **Status: ${runVerifyCommand(verifyCmd, memoryDir)}**`);
      }
    }
    lines.push('', '---', '');
  }

  if (pending.length > 0) {
    lines.push('## Next（按優先度排序）', '');
    for (const t of pending.slice(0, 10)) {
      lines.push(`- [ ] P${getTaskPriority(t)}: ${t.summary}`);
      const verifyCmd = getTaskPayload(t).verifyCommand as string | undefined;
      if (verifyCmd) {
        lines.push(`  Verify: \`${verifyCmd}\``);
        if (runVerify) lines.push(`  - **Status: ${runVerifyCommand(verifyCmd, memoryDir)}**`);
      }
    }
    lines.push('---');
  }

  return lines.join('\n');
}

function runVerifyCommand(cmd: string, cwd: string): string {
  const cleanCmd = cmd.startsWith('`') && cmd.endsWith('`') ? cmd.slice(1, -1) : cmd;
  try {
    execSync(cleanCmd, { cwd, timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] });
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
  const entries = queryMemoryIndexSync(memoryDir, { limit: 200 });
  if (entries.length === 0) return '';

  const lines: string[] = [];
  let used = 0;
  for (const e of entries) {
    const line = `- [${e.type}/${e.status}] ${e.topic ?? 'memory'} ${e.summary ?? e.id}`;
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
