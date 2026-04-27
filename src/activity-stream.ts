import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export interface ActivityEntry {
  ts: string;
  cycle: number;
  action: string;
  tags: string[];
  context: string;
  lane: 'ooda' | 'foreground' | 'delegate';
}

const SIDE_EFFECT_TAGS = new Set([
  'CHAT', 'DELEGATE', 'DONE', 'ASK', 'SHOW', 'REMEMBER',
  'TASK', 'IMPULSE', 'ARCHIVE', 'THREAD',
]);

function getStreamPath(): string {
  return path.join(process.cwd(), 'memory', 'state', 'activity-stream.jsonl');
}

export function emitActivity(entry: {
  cycle: number;
  action: string | null;
  tags: string[];
  sideEffects: string[];
  trigger: string | null;
  lane?: 'ooda' | 'foreground' | 'delegate';
}): void {
  const hasSideEffect = entry.tags.some(t => SIDE_EFFECT_TAGS.has(t));
  if (!hasSideEffect && entry.sideEffects.length === 0) return;

  const context = inferContext(entry.action, entry.sideEffects);
  const record: ActivityEntry = {
    ts: new Date().toISOString(),
    cycle: entry.cycle,
    action: entry.action?.split('\n')[0]?.slice(0, 150) || 'no-action',
    tags: entry.tags,
    context,
    lane: entry.lane ?? 'ooda',
  };

  try {
    appendFileSync(getStreamPath(), JSON.stringify(record) + '\n', 'utf-8');
  } catch { /* fire-and-forget */ }
}

function inferContext(action: string | null, sideEffects: string[]): string {
  const text = `${action ?? ''} ${sideEffects.join(' ')}`.toLowerCase();
  if (/ai.?trend|bump.?chart|arxiv|heatmap|graph\.html/.test(text)) return 'ai-trend';
  if (/kg|knowledge.?graph|discussion|prune/.test(text)) return 'knowledge-graph';
  if (/monitor|dashboard|health|scheduler/.test(text)) return 'activity-monitor';
  if (/telegram|room|chat/.test(text)) return 'communication';
  if (/memory|soul|inner/.test(text)) return 'memory';
  if (/deploy|push|commit|github/.test(text)) return 'deploy';
  return 'general';
}

export function getRecentActivity(limit = 50): ActivityEntry[] {
  const filePath = getStreamPath();
  if (!existsSync(filePath)) return [];
  try {
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
    const entries: ActivityEntry[] = [];
    for (const line of lines.slice(-limit)) {
      try { entries.push(JSON.parse(line)); } catch { /* skip malformed */ }
    }
    return entries;
  } catch { return []; }
}

export function getTodayActivity(): ActivityEntry[] {
  const today = new Date().toISOString().slice(0, 10);
  return getRecentActivity(500).filter(e => e.ts.startsWith(today));
}

export function getActivityByContext(context: string, limit = 50): ActivityEntry[] {
  return getRecentActivity(limit * 3).filter(e => e.context === context).slice(-limit);
}
