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
  if (!entry.action || entry.action === 'no-action') return;

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
  if (/ai.?trend|bump.?chart|arxiv|heatmap|graph\.html|latent.?space/.test(text)) return 'ai-trend';
  if (/kg|knowledge.?graph|discussion|prune|hygiene/.test(text)) return 'knowledge-graph';
  if (/monitor|dashboard|activity.?stream/.test(text)) return 'activity-monitor';
  if (/task.?queue|task.?closure|scheduler|quiescence/.test(text)) return 'task-management';
  if (/telegram|room|chat|通知/.test(text)) return 'communication';
  if (/memory|soul|inner|remember/.test(text)) return 'memory';
  if (/deploy|push|commit|github|shipped/.test(text)) return 'deploy';
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
