/**
 * edges.jsonl → GraphView loader for PPR.
 *
 * Pure IO layer split from kg-ppr.ts so the ranker stays side-effect free.
 * Applies per-type confidence floors (EDGE_TYPE_FLOORS / DEFAULT_EDGE_FLOOR)
 * before buildGraph — below-floor edges are dropped so they cannot leak into
 * retrieval.
 */
import { readFileSync, existsSync } from 'node:fs';
import {
  DEFAULT_EDGE_FLOOR,
  EDGE_TYPE_FLOORS,
  KG_PATHS,
  type EdgeRecord,
} from './kg-types.js';
import { buildGraph, type GraphView } from './kg-ppr.js';

export interface LoadEdgesStats {
  total: number;
  kept: number;
  droppedBelowFloor: number;
  droppedMalformed: number;
}

export interface LoadEdgesOptions {
  /** Override default floors (testing). */
  floors?: Partial<Record<EdgeRecord['type'], number>>;
  defaultFloor?: number;
  /** Drop `mentions` edges — usually noisy, worth toggling in experiments. */
  dropMentions?: boolean;
}

function floorFor(
  type: EdgeRecord['type'],
  overrides: LoadEdgesOptions['floors'],
  defaultFloor: number,
): number {
  return overrides?.[type] ?? EDGE_TYPE_FLOORS[type] ?? defaultFloor;
}

export function parseEdgesJsonl(
  raw: string,
  opts: LoadEdgesOptions = {},
): { edges: EdgeRecord[]; stats: LoadEdgesStats } {
  const defaultFloor = opts.defaultFloor ?? DEFAULT_EDGE_FLOOR;
  const edges: EdgeRecord[] = [];
  const stats: LoadEdgesStats = {
    total: 0,
    kept: 0,
    droppedBelowFloor: 0,
    droppedMalformed: 0,
  };
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    stats.total++;
    let rec: EdgeRecord;
    try {
      rec = JSON.parse(trimmed) as EdgeRecord;
    } catch {
      stats.droppedMalformed++;
      continue;
    }
    if (!rec.from || !rec.to || !rec.type || typeof rec.confidence !== 'number') {
      stats.droppedMalformed++;
      continue;
    }
    if (opts.dropMentions && rec.type === 'mentions') {
      stats.droppedBelowFloor++;
      continue;
    }
    if (rec.confidence < floorFor(rec.type, opts.floors, defaultFloor)) {
      stats.droppedBelowFloor++;
      continue;
    }
    edges.push(rec);
    stats.kept++;
  }
  return { edges, stats };
}

/** Read edges.jsonl from disk; returns empty array + zeroed stats if missing. */
export function loadEdges(
  path: string = KG_PATHS.edges,
  opts: LoadEdgesOptions = {},
): { edges: EdgeRecord[]; stats: LoadEdgesStats } {
  if (!existsSync(path)) {
    return {
      edges: [],
      stats: { total: 0, kept: 0, droppedBelowFloor: 0, droppedMalformed: 0 },
    };
  }
  return parseEdgesJsonl(readFileSync(path, 'utf8'), opts);
}

/** Convenience: load + filter + buildGraph in one call. */
export function loadGraph(
  path: string = KG_PATHS.edges,
  opts: LoadEdgesOptions = {},
): { graph: GraphView; stats: LoadEdgesStats; edges: EdgeRecord[] } {
  const { edges, stats } = loadEdges(path, opts);
  return { graph: buildGraph(edges), stats, edges };
}

// =============================================================================
// Smoke test (run: pnpm tsx src/kg-ppr-loader.ts)
// =============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  const { writeFileSync, mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');

  const dir = mkdtempSync(join(tmpdir(), 'kg-ppr-loader-'));
  const p = join(dir, 'edges.jsonl');

  // Mix of kept / below-floor / malformed / analogy (higher floor)
  const lines = [
    { from: 'A', to: 'B', type: 'supports', confidence: 0.9, detector: 'llm', evidence_chunk_id: 'chk-x', created: 't' },
    { from: 'B', to: 'C', type: 'mentions', confidence: 0.65, detector: 'llm', evidence_chunk_id: 'chk-y', created: 't' },
    { from: 'C', to: 'D', type: 'analogy_to', confidence: 0.70, detector: 'llm', evidence_chunk_id: 'chk-z', created: 't' }, // below 0.75
    { from: 'D', to: 'E', type: 'supports', confidence: 0.50, detector: 'llm', evidence_chunk_id: 'chk-w', created: 't' }, // below 0.6
  ].map((r) => JSON.stringify(r)).concat(['not-json', '']).join('\n');

  writeFileSync(p, lines);

  const { edges, stats } = loadEdges(p);
  console.log('stats:', stats);
  console.log('kept edges:', edges.map((e) => `${e.from}→${e.to}(${e.type})`));
  const ok =
    stats.total === 5 &&
    stats.kept === 2 &&
    stats.droppedBelowFloor === 2 &&
    stats.droppedMalformed === 1;
  console.log('floor filter assertion:', ok ? 'PASS' : 'FAIL');

  const { graph } = loadGraph(p);
  console.log('graph A→?:', graph.outEdges('A'));
  console.log('graph D exists after below-floor drop:', graph.hasNode('D'));
  const hasNodeAssert = graph.hasNode('A') && graph.hasNode('B') && graph.hasNode('C') && !graph.hasNode('E');
  console.log('graph shape assertion:', hasNodeAssert ? 'PASS' : 'FAIL');

  // dropMentions flag
  const { stats: s2 } = loadEdges(p, { dropMentions: true });
  console.log('dropMentions stats:', s2);
  console.log('dropMentions assertion:', s2.kept === 1 ? 'PASS' : 'FAIL');

  rmSync(dir, { recursive: true });

  if (!ok || !hasNodeAssert || s2.kept !== 1) {
    console.error('SMOKE TEST FAIL');
    process.exit(1);
  }
  console.log('\nALL PASS');
}
