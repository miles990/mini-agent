/**
 * Memory Provenance Query Helper — B4 (2026-04-24)
 *
 * Read-only counterpart to `memory-provenance.ts` (B3, Kuro).
 * Answers: "given a memoryId (or content), what provenance exists?"
 *
 * Sources queried:
 *   1. memory/state/memory-provenance.jsonl — authoritative event log (B3)
 *   2. KG edges where `source_event_id` points back (B2 materialized view) — optional
 *
 * Design:
 *   - Linear scan is fine at current volume (<10k rows expected for months).
 *   - KG edge lookup is best-effort; absence is not an error.
 *   - Returns empty chain if nothing found; never throws on normal input.
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { memoryIdForContent, type ProvenanceRecord } from './memory-provenance.js';

export interface KGEdgeProvenance {
  edge_id: string;
  source_event_id: string | null;
  evidence_ref: string[] | null;
  source_tool_call_id: string | null;
  relation: string;
  namespace: string;
  source_agent: string;
  created_at: string;
}

export interface ProvenanceChain {
  memoryId: string;
  records: ProvenanceRecord[];          // JSONL rows matching this memoryId
  kg_edges: KGEdgeProvenance[];         // KG edges with source_event_id = <ts>:<memoryId>
  source_cycles: number[];              // unique cycle numbers referenced
  first_seen: string | null;            // earliest ts
  last_seen: string | null;             // latest ts
}

const PROVENANCE_PATH = path.join(process.cwd(), 'memory', 'state', 'memory-provenance.jsonl');
const KG_BASE = process.env.KG_BASE_URL || 'http://localhost:3300';

/**
 * Resolve a caller-supplied query key to a memoryId.
 * Accepts:
 *   - A full memoryId ("memory-md:...") — passthrough
 *   - Raw content — hashed via the same scheme as B3
 */
export function resolveMemoryId(keyOrContent: string): string {
  if (keyOrContent.startsWith('memory-md:')) return keyOrContent;
  return memoryIdForContent(keyOrContent);
}

async function readJsonlLines(filePath: string): Promise<Record<string, unknown>[]> {
  if (!fs.existsSync(filePath)) return [];
  const rows: Record<string, unknown>[] = [];
  const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed) as Record<string, unknown>);
    } catch {
      // malformed — skip silently
    }
  }
  return rows;
}

async function fetchKGEdges(memoryId: string): Promise<KGEdgeProvenance[]> {
  // KG doesn't (yet) expose a query by source_event_id endpoint. We fetch recent edges
  // in relevant namespaces and filter client-side. At current scale (thousands of edges)
  // this is fine; upgrade to a server-side filter if it becomes a hotspot.
  try {
    const res = await fetch(`${KG_BASE}/api/nodes?limit=1`);
    if (!res.ok) return [];
  } catch {
    return [];
  }

  // Search via query — simple substring match on memoryId prefix in source_event_id.
  // Without a dedicated endpoint, skip; return empty array.
  // Callers can still use `records` from JSONL; KG view is supplementary.
  return [];
}

export async function getProvenance(keyOrContent: string): Promise<ProvenanceChain> {
  const memoryId = resolveMemoryId(keyOrContent);
  const rawRows = await readJsonlLines(PROVENANCE_PATH);

  const records: ProvenanceRecord[] = [];
  for (const raw of rawRows) {
    if (raw.memoryId !== memoryId) continue;
    records.push({
      memoryId: String(raw.memoryId),
      ts: String(raw.ts ?? ''),
      source: raw.source as ProvenanceRecord['source'],
      section: raw.section as string | undefined,
      trust: raw.trust as string | undefined,
      evidence_ref: Array.isArray(raw.evidence_ref) ? raw.evidence_ref.map(String) : [],
      contentPreview: raw.contentPreview as string | undefined,
      bytes: typeof raw.bytes === 'number' ? raw.bytes : undefined,
      agentCycle: typeof raw.agentCycle === 'number' ? raw.agentCycle : undefined,
    });
  }

  const kgEdges = await fetchKGEdges(memoryId);

  const cycles = new Set<number>();
  for (const r of records) {
    if (typeof r.agentCycle === 'number') cycles.add(r.agentCycle);
  }

  const sortedTs = records.map((r) => r.ts).filter(Boolean).sort();

  return {
    memoryId,
    records,
    kg_edges: kgEdges,
    source_cycles: Array.from(cycles).sort((a, b) => a - b),
    first_seen: sortedTs[0] ?? null,
    last_seen: sortedTs[sortedTs.length - 1] ?? null,
  };
}
