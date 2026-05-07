import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { appendMemoryIndexEntry, queryMemoryIndexSync } from './memory-index.js';
import { slog } from './utils.js';

const LEDGER_FILE = 'kg-discussion-lifecycle.jsonl';
const DEFAULT_STALE_DAYS = 7;
const DEFAULT_ROOM_STALE_DAYS = 2;
const DEFAULT_MAX_QUEUED_PER_SWEEP = 5;

export interface KgDiscussionRecord {
  id: string;
  topic?: string;
  namespace?: string;
  description?: string;
  status?: string;
  position_count?: number;
  created_at?: string;
  updated_at?: string;
  merged_into?: string | null;
}

export interface KgDiscussionLifecycleRecord {
  discussionId: string;
  topic: string;
  bucket: 'stale-room' | 'stale-discussion' | 'empty-old-discussion';
  seenAt: string;
  followUpTaskId: string;
}

export interface KgDiscussionSweepResult {
  scanned: number;
  stale: number;
  queued: number;
  skippedKnown: number;
}

export async function sweepKgDiscussionLifecycle(
  memoryDir: string,
  options: {
    discussions?: KgDiscussionRecord[];
    kgUrl?: string;
    now?: Date;
    staleDays?: number;
    roomStaleDays?: number;
    maxQueuedPerSweep?: number;
  } = {},
): Promise<KgDiscussionSweepResult> {
  const now = options.now ?? new Date();
  const discussions = options.discussions ?? await fetchOpenDiscussions(options.kgUrl);
  return classifyKgDiscussions(memoryDir, discussions, now, options);
}

export async function classifyKgDiscussions(
  memoryDir: string,
  discussions: KgDiscussionRecord[],
  now = new Date(),
  options: { staleDays?: number; roomStaleDays?: number; maxQueuedPerSweep?: number } = {},
): Promise<KgDiscussionSweepResult> {
  const known = new Set(readKgDiscussionLifecycleRecords(memoryDir).map(record => record.discussionId));
  const stale = discussions
    .filter(discussion => discussion.status === undefined || discussion.status === 'open')
    .map(discussion => ({ discussion, bucket: classifyDiscussion(discussion, now, options) }))
    .filter((item): item is { discussion: KgDiscussionRecord; bucket: KgDiscussionLifecycleRecord['bucket'] } => item.bucket !== null);

  const result: KgDiscussionSweepResult = {
    scanned: discussions.length,
    stale: stale.length,
    queued: 0,
    skippedKnown: 0,
  };

  for (const item of stale) {
    if (known.has(item.discussion.id)) {
      result.skippedKnown++;
      continue;
    }
    if (result.queued >= (options.maxQueuedPerSweep ?? DEFAULT_MAX_QUEUED_PER_SWEEP)) continue;
    const followUpTaskId = await ensureDiscussionFollowUpTask(memoryDir, item.discussion, item.bucket, now);
    appendLifecycleRecord(memoryDir, {
      discussionId: item.discussion.id,
      topic: item.discussion.topic ?? item.discussion.description ?? item.discussion.id,
      bucket: item.bucket,
      seenAt: now.toISOString(),
      followUpTaskId,
    });
    result.queued++;
  }

  if (result.queued > 0) {
    slog('KG-DISCUSSION-JANITOR', `queued ${result.queued}/${result.stale} stale KG discussion follow-up(s)`);
  }
  return result;
}

export function getKgDiscussionLifecyclePath(memoryDir: string): string {
  return path.join(memoryDir, 'index', LEDGER_FILE);
}

export function readKgDiscussionLifecycleRecords(memoryDir: string): KgDiscussionLifecycleRecord[] {
  const filePath = ensureLedger(memoryDir);
  const latest = new Map<string, KgDiscussionLifecycleRecord>();
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const raw = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof raw.discussionId !== 'string' || typeof raw.topic !== 'string' || typeof raw.seenAt !== 'string') continue;
      const bucket = raw.bucket;
      if (bucket !== 'stale-room' && bucket !== 'stale-discussion' && bucket !== 'empty-old-discussion') continue;
      if (typeof raw.followUpTaskId !== 'string') continue;
      latest.set(raw.discussionId, {
        discussionId: raw.discussionId,
        topic: raw.topic,
        bucket,
        seenAt: raw.seenAt,
        followUpTaskId: raw.followUpTaskId,
      });
    } catch {
      continue;
    }
  }
  return [...latest.values()].sort((a, b) => b.seenAt.localeCompare(a.seenAt));
}

export function isKgDiscussionLifecycleKnown(memoryDir: string, discussionId: string): boolean {
  return readKgDiscussionLifecycleRecords(memoryDir).some(record => record.discussionId === discussionId);
}

function classifyDiscussion(
  discussion: KgDiscussionRecord,
  now: Date,
  options: { staleDays?: number; roomStaleDays?: number },
): KgDiscussionLifecycleRecord['bucket'] | null {
  if (discussion.merged_into) return null;
  const updatedAt = Date.parse(discussion.updated_at ?? discussion.created_at ?? '');
  if (!Number.isFinite(updatedAt)) return null;
  const ageDays = (now.getTime() - updatedAt) / 86400_000;
  const topic = discussion.topic ?? '';
  const isRoom = discussion.namespace === 'kuro' && /^room-\d{4}-\d{2}-\d{2}$/.test(topic);
  if (isRoom && ageDays >= (options.roomStaleDays ?? DEFAULT_ROOM_STALE_DAYS)) return 'stale-room';
  if ((discussion.position_count ?? 0) === 0 && ageDays >= (options.roomStaleDays ?? DEFAULT_ROOM_STALE_DAYS)) return 'empty-old-discussion';
  if (ageDays >= (options.staleDays ?? DEFAULT_STALE_DAYS)) return 'stale-discussion';
  return null;
}

async function ensureDiscussionFollowUpTask(
  memoryDir: string,
  discussion: KgDiscussionRecord,
  bucket: KgDiscussionLifecycleRecord['bucket'],
  now: Date,
): Promise<string> {
  const existing = queryMemoryIndexSync(memoryDir, { type: ['task'], status: ['pending', 'in_progress', 'hold'] })
    .find(entry => {
      const payload = (entry.payload ?? {}) as Record<string, unknown>;
      return payload.origin === 'kg-discussion-janitor' && payload.kg_discussion_id === discussion.id;
    });
  if (existing) return existing.id;

  const topic = discussion.topic ?? discussion.description ?? discussion.id;
  const entry = await appendMemoryIndexEntry(memoryDir, {
    type: 'task',
    status: 'pending',
    summary: `KG discussion ${discussion.id}: close or refresh ${topic.slice(0, 100)}`,
    refs: [],
    tags: ['kg', 'discussion-lifecycle', bucket],
    payload: {
      origin: 'kg-discussion-janitor',
      kg_discussion_id: discussion.id,
      kg_discussion_topic: topic,
      kg_discussion_bucket: bucket,
      acceptance_criteria: 'Discussion is resolved, merged, archived, or refreshed with a current position and provenance.',
      createdAt: now.toISOString(),
    },
  });
  return entry.id;
}

function appendLifecycleRecord(memoryDir: string, record: KgDiscussionLifecycleRecord): void {
  appendFileSync(ensureLedger(memoryDir), JSON.stringify(record) + '\n', 'utf-8');
}

function ensureLedger(memoryDir: string): string {
  const filePath = getKgDiscussionLifecyclePath(memoryDir);
  const dir = path.dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(filePath)) writeFileSync(filePath, '', 'utf-8');
  return filePath;
}

async function fetchOpenDiscussions(kgUrl?: string): Promise<KgDiscussionRecord[]> {
  const base = (kgUrl ?? process.env.KG_URL ?? 'http://127.0.0.1:3300').replace(/\/+$/, '');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${base}/api/discussions?status=open`, { signal: controller.signal });
    if (!response.ok) return [];
    const body = await response.json() as Record<string, unknown>;
    return Array.isArray(body.discussions) ? body.discussions as KgDiscussionRecord[] : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
