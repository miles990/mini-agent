import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getInstanceDir } from './instance.js';
import { slog } from './utils.js';

const REVIEW_BACKLOG_FILE = 'review-backlog.jsonl';
const BACKLOG_TTL_MS = 6 * 3600_000;
const REVIEW_BACKLOG_KEEP_CAP = 10;

export function pruneReviewBacklog(instanceId: string, now = Date.now()): { pruned: number; remaining: number } {
  const filePath = path.join(getInstanceDir(instanceId), REVIEW_BACKLOG_FILE);
  if (!existsSync(filePath)) return { pruned: 0, remaining: 0 };

  const kept: string[] = [];
  let total = 0;
  for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    total++;
    try {
      const entry = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof entry.id !== 'string' || typeof entry.archivedAt !== 'string') continue;
      if (now - Date.parse(entry.archivedAt) >= BACKLOG_TTL_MS) continue;
      if (typeof entry.summary === 'string' && isStaleFailureOutput(entry.summary)) continue;
      kept.push(trimmed);
    } catch {
      continue;
    }
  }

  kept.sort((a, b) => {
    const left = JSON.parse(a) as { archivedAt?: string };
    const right = JSON.parse(b) as { archivedAt?: string };
    return Date.parse(right.archivedAt ?? '') - Date.parse(left.archivedAt ?? '');
  });
  const capped = kept.slice(0, REVIEW_BACKLOG_KEEP_CAP);
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, capped.length > 0 ? `${capped.join('\n')}\n` : '', 'utf-8');
  renameSync(tmpPath, filePath);

  const pruned = total - capped.length;
  if (pruned > 0) slog('REVIEW-BACKLOG', `pruned ${pruned} stale/noise delegation result(s), remaining=${capped.length}`);
  return { pruned, remaining: capped.length };
}

function isStaleFailureOutput(summary: string): boolean {
  const lower = summary.trim().toLowerCase();
  if (!lower) return true;
  if (lower === '(no output)') return true;
  if (lower.startsWith('[failed shell]')) return true;
  if (lower.startsWith('dispatch error')) return true;
  if (/middleware offline|econnrefused|fetch failed/.test(lower)) return true;
  return false;
}
