/**
 * KG Query — human-facing retrieval over registry + PPR.
 *
 * Ties the pieces together: name → entity id (registry alias index) →
 * PPR seeds → ranked entities → decorated with canonical_name, type,
 * top references. Single call site for end-to-end graph queries.
 *
 * No LLM calls. Pure deterministic retrieval.
 */

import { KG_PATHS, type EntityRecord, type EdgeRecord } from './kg-types.js';
import {
  loadRegistry,
  findExisting,
  type Registry,
} from './kg-entity-registry.js';
import { loadGraph, type LoadEdgesOptions } from './kg-ppr-loader.js';
import { ppr, type PPROptions } from './kg-ppr.js';

export interface ResolvedSeed {
  probe: string;
  entity?: EntityRecord;
}

export interface QueryResult {
  entity: EntityRecord;
  score: number;
  topReferences: Array<{ chunk_id: string; span?: string; confidence?: number }>;
}

export interface QueryReport {
  seeds: ResolvedSeed[];
  resolved: string[];
  missing: string[];
  results: QueryResult[];
  subgraph: EdgeRecord[];
  stats: {
    totalEntities: number;
    totalEdges: number;
    edgesAfterFloor: number;
    topK: number;
  };
}

export interface QueryOptions extends PPROptions {
  entitiesPath?: string;
  edgesPath?: string;
  loader?: LoadEdgesOptions;
  refsPerResult?: number;
}

export function query(probes: ReadonlyArray<string>, opts: QueryOptions = {}): QueryReport {
  const registry = loadRegistry((opts.entitiesPath ?? KG_PATHS.entities) as typeof KG_PATHS.entities);
  const { graph, stats: edgeStats, edges } = loadGraph(
    (opts.edgesPath ?? KG_PATHS.edges) as typeof KG_PATHS.edges,
    opts.loader,
  );

  const seeds = probes.map((p) => ({ probe: p, entity: resolveProbe(registry, p) }));
  const resolvedIds = seeds
    .filter((s): s is ResolvedSeed & { entity: EntityRecord } => !!s.entity)
    .map((s) => s.entity.id);
  const missing = seeds.filter((s) => !s.entity).map((s) => s.probe);

  const topK = opts.topK ?? 20;
  const ranked = resolvedIds.length > 0 ? ppr(resolvedIds, graph, { ...opts, topK }) : [];

  const refsPerResult = opts.refsPerResult ?? 3;
  const results: QueryResult[] = [];

  if (ranked.length === 0 && resolvedIds.length > 0) {
    // No edges loaded — still return seed entities themselves as baseline.
    for (const id of resolvedIds) {
      const rec = registry.byId.get(id);
      if (!rec) continue;
      results.push({ entity: rec, score: 1 / resolvedIds.length, topReferences: selectTopRefs(rec, refsPerResult) });
    }
  } else {
    for (const { entity: id, score } of ranked) {
      const rec = registry.byId.get(id);
      if (!rec) continue;
      results.push({ entity: rec, score, topReferences: selectTopRefs(rec, refsPerResult) });
    }
  }

  const resultIds = new Set(results.map((r) => r.entity.id));
  const subgraph = edges.filter((e) => resultIds.has(e.from) && resultIds.has(e.to));

  return {
    seeds,
    resolved: resolvedIds,
    missing,
    results,
    subgraph,
    stats: {
      totalEntities: registry.byId.size,
      totalEdges: edgeStats.total,
      edgesAfterFloor: edgeStats.kept,
      topK,
    },
  };
}

function resolveProbe(reg: Registry, probe: string): EntityRecord | undefined {
  return findExisting(reg, { canonical_name: probe, type: 'concept' });
}

function selectTopRefs(rec: EntityRecord, n: number) {
  const withScore = rec.references.map((r) => ({
    chunk_id: r.chunk_id,
    span: r.span,
    confidence: r.confidence,
  }));
  withScore.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  return withScore.slice(0, n);
}

export function formatReport(r: QueryReport): string {
  const lines: string[] = [];
  lines.push(`# KG Query`);
  lines.push(``);
  lines.push(`Seeds: ${r.seeds.map((s) => s.entity ? `✓ ${s.probe} → ${s.entity.id}` : `✗ ${s.probe}`).join(', ')}`);
  if (r.missing.length) lines.push(`Missing: ${r.missing.join(', ')}`);
  lines.push(`Graph: ${r.stats.totalEntities} entities, ${r.stats.edgesAfterFloor}/${r.stats.totalEdges} edges after floor`);
  lines.push(``);
  lines.push(`## Top ${r.results.length} by PPR score`);
  lines.push(``);
  for (const { entity, score, topReferences } of r.results) {
    lines.push(`### ${entity.canonical_name}  \`[${entity.type}]\``);
    lines.push(`- id: \`${entity.id}\`  score: ${score.toFixed(4)}`);
    if (entity.aliases.length) lines.push(`- aliases: ${entity.aliases.join(', ')}`);
    if (topReferences.length) {
      lines.push(`- refs:`);
      for (const ref of topReferences) {
        const spanPart = ref.span ? ` — "${ref.span}"` : '';
        const confPart = ref.confidence !== undefined ? ` (${ref.confidence.toFixed(2)})` : '';
        lines.push(`  - ${ref.chunk_id}${confPart}${spanPart}`);
      }
    }
    lines.push(``);
  }
  if (r.subgraph.length) {
    lines.push(`## Subgraph (${r.subgraph.length} edges among results)`);
    lines.push(``);
    for (const e of r.subgraph.slice(0, 20)) {
      const quote = e.evidence_quote ? ` — "${e.evidence_quote}"` : '';
      lines.push(`- ${e.from} —[${e.type} ${e.confidence.toFixed(2)}]→ ${e.to}${quote}`);
    }
    if (r.subgraph.length > 20) lines.push(`- … ${r.subgraph.length - 20} more`);
  }
  return lines.join('\n');
}
