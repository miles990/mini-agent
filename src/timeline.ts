/**
 * Timeline — unified time-series event view for debugging and Memory Inspector.
 *
 * Merges multiple JSONL event sources into a normalized, time-sorted feed.
 * Sources:
 *   - memory/context-checkpoints/*.jsonl  → buildContext snapshots (cycle events)
 *   - memory/conversations/*.jsonl         → chat room messages
 *   - ~/.mini-agent/instances/{id}/delegation-journal.jsonl → delegation events
 *
 * Implementation note: only files whose YYYY-MM-DD name overlaps [from, to] are read,
 * keeping reads O(days-in-range). Each event is parsed once, never held in memory longer
 * than the request.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { getInstanceDir, getCurrentInstanceId } from './instance.js';

export type TimelineEventType =
  | 'context-snapshot'
  | 'conversation'
  | 'delegation'
  | 'unknown';

export interface TimelineEvent {
  ts: string;                      // ISO 8601
  type: TimelineEventType;
  source: string;                  // filename or logical source id
  summary: string;                 // one-line human readable
  data: Record<string, unknown>;   // original event payload (lossless)
}

export interface TimelineQuery {
  from?: string;      // ISO 8601 (default: 24h ago)
  to?: string;        // ISO 8601 (default: now)
  types?: TimelineEventType[];  // filter, default all
  limit?: number;     // cap result count, default 500
}

export interface TimelineResult {
  events: TimelineEvent[];
  range: { from: string; to: string };
  count: number;
  truncated: boolean;
  sources_read: string[];
}

const PROJECT_ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const MEMORY_ROOT = path.join(PROJECT_ROOT, 'memory');
const CHECKPOINT_DIR = path.join(MEMORY_ROOT, 'context-checkpoints');
const CONVERSATION_DIR = path.join(MEMORY_ROOT, 'conversations');

function isoDayRange(from: Date, to: Date): string[] {
  const days: string[] = [];
  const cursor = new Date(from.getTime());
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(to.getTime());
  end.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() <= end.getTime()) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

async function readJsonl(
  filePath: string,
  onLine: (obj: Record<string, unknown>) => void,
): Promise<void> {
  if (!fs.existsSync(filePath)) return;
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      onLine(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      // skip malformed line — keep going
    }
  }
}

function inRange(ts: string | undefined, from: number, to: number): boolean {
  if (!ts) return false;
  const t = Date.parse(ts);
  if (Number.isNaN(t)) return false;
  return t >= from && t <= to;
}

function summarizeCheckpoint(obj: Record<string, unknown>): string {
  const mode = obj.mode ?? 'unknown';
  const len = obj.contextLength ?? 0;
  const sections = Array.isArray(obj.sections) ? obj.sections.length : 0;
  return `buildContext mode=${String(mode)} len=${len} sections=${sections}`;
}

function summarizeConversation(obj: Record<string, unknown>): string {
  const from = obj.from ?? '?';
  const text = typeof obj.text === 'string' ? obj.text : '';
  const preview = text.length > 80 ? `${text.slice(0, 80)}…` : text;
  return `${String(from)}: ${preview}`;
}

function summarizeDelegation(obj: Record<string, unknown>): string {
  const type = obj.type ?? 'unknown';
  const status = obj.status ?? '?';
  const id = obj.id ?? '?';
  return `delegate ${String(type)} ${String(id)} → ${String(status)}`;
}

async function readCheckpoints(
  days: string[],
  fromMs: number,
  toMs: number,
  out: TimelineEvent[],
  sourcesRead: string[],
): Promise<void> {
  for (const day of days) {
    const file = path.join(CHECKPOINT_DIR, `${day}.jsonl`);
    if (!fs.existsSync(file)) continue;
    sourcesRead.push(`checkpoints/${day}.jsonl`);
    await readJsonl(file, (obj) => {
      const ts = typeof obj.timestamp === 'string' ? obj.timestamp : undefined;
      if (!inRange(ts, fromMs, toMs)) return;
      out.push({
        ts: ts as string,
        type: 'context-snapshot',
        source: `checkpoints/${day}.jsonl`,
        summary: summarizeCheckpoint(obj),
        data: obj,
      });
    });
  }
}

async function readConversations(
  days: string[],
  fromMs: number,
  toMs: number,
  out: TimelineEvent[],
  sourcesRead: string[],
): Promise<void> {
  for (const day of days) {
    const file = path.join(CONVERSATION_DIR, `${day}.jsonl`);
    if (!fs.existsSync(file)) continue;
    sourcesRead.push(`conversations/${day}.jsonl`);
    await readJsonl(file, (obj) => {
      const ts = typeof obj.ts === 'string' ? obj.ts : undefined;
      if (!inRange(ts, fromMs, toMs)) return;
      out.push({
        ts: ts as string,
        type: 'conversation',
        source: `conversations/${day}.jsonl`,
        summary: summarizeConversation(obj),
        data: obj,
      });
    });
  }
}

async function readDelegations(
  fromMs: number,
  toMs: number,
  out: TimelineEvent[],
  sourcesRead: string[],
): Promise<void> {
  const instanceDir = getInstanceDir(getCurrentInstanceId());
  const file = path.join(instanceDir, 'delegation-journal.jsonl');
  if (!fs.existsSync(file)) return;
  sourcesRead.push('delegation-journal.jsonl');
  await readJsonl(file, (obj) => {
    const ts = typeof obj.ts === 'string' ? obj.ts : undefined;
    if (!inRange(ts, fromMs, toMs)) return;
    out.push({
      ts: ts as string,
      type: 'delegation',
      source: 'delegation-journal.jsonl',
      summary: summarizeDelegation(obj),
      data: obj,
    });
  });
}

export async function queryTimeline(query: TimelineQuery = {}): Promise<TimelineResult> {
  const now = Date.now();
  const defaultFrom = now - 24 * 60 * 60 * 1000;
  const fromMs = query.from ? Date.parse(query.from) : defaultFrom;
  const toMs = query.to ? Date.parse(query.to) : now;
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) {
    throw new Error('invalid from/to ISO timestamp');
  }
  if (fromMs > toMs) {
    throw new Error('from must be <= to');
  }

  const limit = Math.max(1, Math.min(5000, query.limit ?? 500));
  const typeFilter = new Set(query.types ?? []);
  const days = isoDayRange(new Date(fromMs), new Date(toMs));

  const events: TimelineEvent[] = [];
  const sourcesRead: string[] = [];

  const wantType = (t: TimelineEventType) => typeFilter.size === 0 || typeFilter.has(t);

  const tasks: Promise<void>[] = [];
  if (wantType('context-snapshot')) tasks.push(readCheckpoints(days, fromMs, toMs, events, sourcesRead));
  if (wantType('conversation')) tasks.push(readConversations(days, fromMs, toMs, events, sourcesRead));
  if (wantType('delegation')) tasks.push(readDelegations(fromMs, toMs, events, sourcesRead));
  await Promise.all(tasks);

  events.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  const truncated = events.length > limit;
  const sliced = truncated ? events.slice(-limit) : events;

  return {
    events: sliced,
    range: { from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() },
    count: sliced.length,
    truncated,
    sources_read: sourcesRead,
  };
}
