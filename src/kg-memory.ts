import { readFileSync, readdirSync, appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { slog } from './utils.js';

const KG_BASE = 'http://localhost:3300';

function getCachePath(): string {
  return path.join(process.cwd(), 'memory', 'state', 'kg-memory-cache.jsonl');
}

export type MemoryPredicate = 'remembers' | 'learned' | 'decided' | 'pledged' | 'observed';
export type Importance = 'high' | 'medium' | 'low';
export type Visibility = 'private' | 'shared';

export interface AgentMemoryEntry {
  predicate: MemoryPredicate;
  content: string;
  importance: Importance;
  topic?: string;
  created_at: string;
  visibility: Visibility;
  node_id?: string;
}

interface WriteMemoryOpts {
  agent: string;
  predicate: MemoryPredicate;
  content: string;
  topic?: string;
  importance?: Importance;
  source?: string;
  visibility?: Visibility;
}

interface LoadMemoryOpts {
  agent: string;
  budget_tokens?: number;
  min_importance?: Importance;
}

const IMPORTANCE_RANK: Record<Importance, number> = { high: 3, medium: 2, low: 1 };

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function writeMemoryTriple(opts: WriteMemoryOpts): void {
  const agentSubject = `agent:${opts.agent}`;
  const body = {
    subject: agentSubject,
    subject_type: 'agent',
    predicate: opts.predicate,
    object: opts.content.slice(0, 2000),
    object_type: 'agent-memory',
    namespace: opts.agent,
    confidence: opts.importance === 'high' ? 0.95 : opts.importance === 'medium' ? 0.8 : 0.6,
    source_agent: opts.agent,
    description: `[${opts.agent}] ${opts.predicate}: ${opts.content.slice(0, 120)}`,
    properties: {
      importance: opts.importance ?? 'medium',
      topic: opts.topic ?? null,
      source: opts.source ?? 'unknown',
      created_at: new Date().toISOString(),
      visibility: opts.visibility ?? 'private',
      memory_type: 'agent-memory',
    },
  };

  // Local cache (instant, survives KG outage)
  const cacheEntry: AgentMemoryEntry = {
    predicate: opts.predicate,
    content: opts.content.slice(0, 2000),
    importance: opts.importance ?? 'medium',
    topic: opts.topic,
    created_at: new Date().toISOString(),
    visibility: opts.visibility ?? 'private',
  };
  try { appendFileSync(getCachePath(), JSON.stringify(cacheEntry) + '\n', 'utf-8'); } catch { /* fire-and-forget */ }

  // KG write (async, source of truth)
  fetch(`${KG_BASE}/api/write/triple`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  }).then(r => {
    if (!r.ok) slog('KG-MEMORY', `write failed: ${r.status}`);
  }).catch(() => { /* fire-and-forget */ });
}

export async function loadAgentMemory(opts: LoadMemoryOpts): Promise<AgentMemoryEntry[]> {
  const budget = opts.budget_tokens ?? 5000;
  const minImportance = opts.min_importance ?? 'low';
  const minRank = IMPORTANCE_RANK[minImportance];

  // Read from local cache (instant, always available)
  const memories = loadFromCache(minRank);

  // Sort: importance desc, then recency desc
  memories.sort((a, b) => {
    const rankDiff = IMPORTANCE_RANK[b.importance] - IMPORTANCE_RANK[a.importance];
    if (rankDiff !== 0) return rankDiff;
    return (b.created_at ?? '').localeCompare(a.created_at ?? '');
  });

  // Apply token budget
  let usedTokens = 0;
  const result: AgentMemoryEntry[] = [];
  for (const m of memories) {
    const tokens = estimateTokens(m.content);
    if (usedTokens + tokens > budget) break;
    usedTokens += tokens;
    result.push(m);
  }

  return result;
}

function loadFromCache(minRank: number): AgentMemoryEntry[] {
  const filePath = getCachePath();
  if (!existsSync(filePath)) return [];
  try {
    const lines = readFileSync(filePath, 'utf-8').trim().split('\n').filter(Boolean);
    const entries: AgentMemoryEntry[] = [];
    for (const line of lines) {
      try {
        const e = JSON.parse(line) as AgentMemoryEntry;
        if (IMPORTANCE_RANK[e.importance] >= minRank) entries.push(e);
      } catch { /* skip malformed */ }
    }
    return entries;
  } catch { return []; }
}

export function formatMemorySection(memories: AgentMemoryEntry[]): string {
  if (memories.length === 0) return '';
  const lines = memories.map(m => {
    const topicTag = m.topic ? ` [${m.topic}]` : '';
    return `- [${m.predicate}]${topicTag} ${m.content}`;
  });
  return `## KG Persistent Memory (${memories.length} entries)\n${lines.join('\n')}`;
}

export async function syncMemoryToKG(opts: {
  agent: string;
  memoryDir: string;
}): Promise<{ synced: number; skipped: number }> {
  const triples: Array<Record<string, unknown>> = [];

  // Parse MEMORY.md
  const memoryPath = path.join(opts.memoryDir, 'MEMORY.md');
  try {
    const content = readFileSync(memoryPath, 'utf-8');
    const bullets = content.split('\n').filter(l => l.trim().startsWith('- '));
    for (const bullet of bullets) {
      const text = bullet.replace(/^-\s*/, '').trim();
      if (!text || text.length < 10) continue;
      const isAnchor = /\*\*/.test(text);
      triples.push({
        subject: `agent:${opts.agent}`,
        subject_type: 'agent',
        predicate: 'remembers',
        object: text.slice(0, 2000),
        object_type: 'agent-memory',
        namespace: opts.agent,
        confidence: isAnchor ? 0.95 : 0.6,
        source_agent: opts.agent,
        description: `[${opts.agent}] Migration: ${text.slice(0, 80)}`,
        properties: {
          importance: isAnchor ? 'high' : 'low',
          source: 'migration',
          created_at: new Date().toISOString(),
          visibility: 'private',
          memory_type: 'agent-memory',
        },
      });
    }
  } catch { /* no MEMORY.md */ }

  // Parse topics/*.md
  const topicsDir = path.join(opts.memoryDir, 'topics');
  try {
    const files = readdirSync(topicsDir).filter(f => f.endsWith('.md') && !f.startsWith('.'));
    for (const file of files) {
      const topic = file.replace(/\.md$/, '');
      const content = readFileSync(path.join(topicsDir, file), 'utf-8');
      const bullets = content.split('\n').filter(l => l.trim().startsWith('- '));
      for (const bullet of bullets) {
        const text = bullet.replace(/^-\s*/, '').trim();
        if (!text || text.length < 10) continue;
        triples.push({
          subject: `agent:${opts.agent}`,
          subject_type: 'agent',
          predicate: 'remembers',
          object: text.slice(0, 2000),
          object_type: 'agent-memory',
          namespace: opts.agent,
          confidence: 0.8,
          source_agent: opts.agent,
          description: `[${opts.agent}] Migration [${topic}]: ${text.slice(0, 60)}`,
          properties: {
            importance: 'medium',
            topic,
            source: 'migration',
            created_at: new Date().toISOString(),
            visibility: 'private',
            memory_type: 'agent-memory',
          },
        });
      }
    }
  } catch { /* no topics dir */ }

  if (triples.length === 0) return { synced: 0, skipped: 0 };

  // Write to local cache for instant startup reads
  for (const t of triples) {
    const props = t.properties as Record<string, unknown>;
    const cacheEntry: AgentMemoryEntry = {
      predicate: (t.predicate as MemoryPredicate) ?? 'remembers',
      content: t.object as string,
      importance: (props.importance as Importance) ?? 'medium',
      topic: (props.topic as string) ?? undefined,
      created_at: (props.created_at as string) ?? new Date().toISOString(),
      visibility: (props.visibility as Visibility) ?? 'private',
    };
    try { appendFileSync(getCachePath(), JSON.stringify(cacheEntry) + '\n', 'utf-8'); } catch { /* skip */ }
  }

  let synced = 0;
  let skipped = 0;
  // Batch write to KG in chunks of 100
  for (let i = 0; i < triples.length; i += 100) {
    const batch = triples.slice(i, i + 100);
    try {
      const res = await fetch(`${KG_BASE}/api/write/triples`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triples: batch }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        synced += batch.length;
      } else {
        skipped += batch.length;
        slog('KG-MEMORY', `batch write failed: ${res.status}`);
      }
    } catch {
      skipped += batch.length;
    }
  }

  slog('KG-MEMORY', `migration complete: synced=${synced}, skipped=${skipped}`);
  return { synced, skipped };
}
