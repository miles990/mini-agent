/**
 * Personalized PageRank (PPR) for Memory Retrieval — v0
 *
 * Design: memory/proposals/2026-04-15-ppr-design-v0.md
 * Schema: src/kg-types.ts (1f57ad69)
 *
 * Pure function: (seeds, graph, options) → ranked entity ids.
 * No IO, no cache. Upstream (retrieval pipeline) loads edges.jsonl and hands
 * us an in-memory adjacency view. When CC's P0#4 syntax edges land, the only
 * missing piece is the edges.jsonl → GraphView loader.
 */
import type { EdgeRecord } from './kg-types.js';

export interface GraphView {
  outEdges(from: string): ReadonlyArray<{ to: string; confidence: number }>;
  hasNode(id: string): boolean;
}

export interface PPROptions {
  alpha?: number;   // teleport probability (default 0.15)
  iters?: number;   // max iterations (default 20)
  topK?: number;    // return size (default 50)
  tol?: number;     // early-stop L1 diff threshold (default 1e-4)
}

export interface PPRResult {
  entity: string;
  score: number;
}

/**
 * Build a GraphView from an in-memory edge list. Caller decides filtering
 * (e.g., drop below-floor edges); we trust inputs.
 */
export function buildGraph(edges: ReadonlyArray<Pick<EdgeRecord, 'from' | 'to' | 'confidence'>>): GraphView {
  const adj = new Map<string, Array<{ to: string; confidence: number }>>();
  const nodes = new Set<string>();
  for (const e of edges) {
    nodes.add(e.from);
    nodes.add(e.to);
    const list = adj.get(e.from) ?? [];
    list.push({ to: e.to, confidence: e.confidence });
    adj.set(e.from, list);
  }
  return {
    outEdges: (from) => adj.get(from) ?? [],
    hasNode: (id) => nodes.has(id),
  };
}

/**
 * Personalized PageRank.
 *
 * seeds → teleport distribution. Each iteration:
 *   next[n] = α · v[n] + (1-α) · Σ_{(u→n)} rank[u] · (conf / outSum[u])
 * Dangling nodes (out-degree 0) teleport their full mass back to v (standard).
 *
 * Returns topK by score, sorted descending.
 */
export function ppr(
  seeds: ReadonlyArray<string>,
  graph: GraphView,
  options: PPROptions = {},
): PPRResult[] {
  const alpha = options.alpha ?? 0.15;
  const maxIters = options.iters ?? 20;
  const topK = options.topK ?? 50;
  const tol = options.tol ?? 1e-4;

  if (seeds.length === 0) return [];

  const teleport = initTeleport(seeds);
  let rank = new Map(teleport);

  for (let i = 0; i < maxIters; i++) {
    const next = new Map<string, number>();
    // α portion: teleport to seeds
    for (const [node, mass] of teleport) next.set(node, alpha * mass);

    // (1-α) portion: walk along out-edges weighted by confidence
    let danglingMass = 0;
    for (const [node, mass] of rank) {
      const outs = graph.outEdges(node);
      if (outs.length === 0) {
        danglingMass += mass;
        continue;
      }
      const total = outs.reduce((s, e) => s + e.confidence, 0);
      if (total === 0) {
        danglingMass += mass;
        continue;
      }
      for (const e of outs) {
        const contrib = (1 - alpha) * mass * (e.confidence / total);
        next.set(e.to, (next.get(e.to) ?? 0) + contrib);
      }
    }
    // Dangling: distribute over teleport (standard PageRank handling)
    if (danglingMass > 0) {
      for (const [node, mass] of teleport) {
        next.set(node, (next.get(node) ?? 0) + (1 - alpha) * danglingMass * mass);
      }
    }

    if (l1Diff(rank, next) < tol) {
      rank = next;
      break;
    }
    rank = next;
  }

  return [...rank.entries()]
    .map(([entity, score]) => ({ entity, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function initTeleport(seeds: ReadonlyArray<string>): Map<string, number> {
  const unique = [...new Set(seeds)];
  const mass = 1 / unique.length;
  return new Map(unique.map((s) => [s, mass]));
}

function l1Diff(a: Map<string, number>, b: Map<string, number>): number {
  const keys = new Set([...a.keys(), ...b.keys()]);
  let diff = 0;
  for (const k of keys) diff += Math.abs((a.get(k) ?? 0) - (b.get(k) ?? 0));
  return diff;
}

// =============================================================================
// Smoke test (run: node --loader tsx src/kg-ppr.ts)
// =============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  // 3-node triangle: A → B → C → A, all confidence 1.0
  const edges = [
    { from: 'A', to: 'B', confidence: 1.0 },
    { from: 'B', to: 'C', confidence: 1.0 },
    { from: 'C', to: 'A', confidence: 1.0 },
  ];
  const g = buildGraph(edges);
  const r1 = ppr(['A'], g, { alpha: 0.15, iters: 50 });
  console.log('seed=A triangle:', r1);

  // Dangling case: A → B, B has no outs
  const g2 = buildGraph([{ from: 'A', to: 'B', confidence: 1.0 }]);
  const r2 = ppr(['A'], g2, { alpha: 0.15, iters: 50 });
  console.log('seed=A dangling B:', r2);
  const sum = r2.reduce((s, x) => s + x.score, 0);
  console.log('mass conserved:', sum.toFixed(4), '(expect ≈ 1.0)');

  // Multi-seed: seeds share mass
  const r3 = ppr(['A', 'B'], g, { alpha: 0.15, iters: 50 });
  console.log('seeds=A,B triangle:', r3);
}
