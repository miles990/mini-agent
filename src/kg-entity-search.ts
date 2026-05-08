import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const ENTITIES_PATH = path.join(ROOT, 'memory/index/entities.jsonl');
const RESOLVED_PATH = path.join(ROOT, 'memory/index/entities-resolved.jsonl');
const EDGES_PATH = path.join(ROOT, 'memory/index/edges.jsonl');
const MANIFEST_PATH = path.join(ROOT, 'memory/index/manifest.json');
const CONFLICTS_PATH = path.join(ROOT, 'memory/index/conflicts.jsonl');

interface EntityReference {
  chunk_id: string;
  span?: string;
  confidence?: number;
}

interface Entity {
  id: string;
  type: string;
  canonical_name: string;
  aliases: string[];
  first_seen?: string;
  last_referenced?: string;
  references: EntityReference[];
  resolved_type?: string | string[];
  resolution_confidence?: 'high' | 'medium' | 'low';
  resolution_rule?: string;
  alternatives?: string[];
}

interface Edge {
  from: string;
  to: string;
  type: string;
  confidence?: number;
  weight?: number;
  detector?: string;
  evidence_chunk_id?: string;
}

interface Conflict {
  id: string;
  type: string;
  entities: string[];
  status: string;
  detected_at?: string;
}

export interface SearchHit {
  id: string;
  canonical_name: string;
  type: string;
  aliases: string[];
  reference_count: number;
  match: 'name' | 'alias' | 'id';
}

export interface Neighbor {
  id: string;
  canonical_name: string;
  type: string;
  edge_type: string;
  direction: 'out' | 'in';
  weight: number;
  confidence: number;
}

export interface EntityCard {
  id: string;
  canonical_name: string;
  type: string;
  resolved_type?: string | string[];
  resolution_rule?: string;
  resolution_confidence?: string;
  alternatives?: string[];
  aliases: string[];
  first_seen?: string;
  last_referenced?: string;
  reference_count: number;
  references: EntityReference[];
  neighbors: Neighbor[];
}

export interface KgOverview {
  generated_at: string;
  manifest: Record<string, unknown> | null;
  stats: {
    entities: number;
    edges: number;
    resolved: number;
    conflicts: number;
    pending_conflicts: number;
    orphan_entities: number;
    low_confidence_entities: number;
    low_confidence_edges: number;
  };
  type_counts: Array<{ type: string; count: number }>;
  edge_type_counts: Array<{ type: string; count: number; avg_confidence: number; avg_weight: number }>;
  confidence_bands: Array<{ band: string; count: number }>;
  detector_counts: Array<{ detector: string; count: number }>;
  top_entities: Array<{ id: string; name: string; type: string; refs: number; degree: number; confidence?: string }>;
  recent_entities: Array<{ id: string; name: string; type: string; last_referenced?: string; refs: number }>;
  conflict_entities: Array<{ id: string; name: string; type: string; conflicts: string[] }>;
  graph: {
    nodes: Array<{ id: string; name: string; type: string; refs: number; degree: number; confidence?: string; conflict: boolean }>;
    links: Array<{ source: string; target: string; type: string; weight: number; confidence: number; detector?: string }>;
  };
}

interface Cache {
  entitiesMtime: number;
  resolvedMtime: number;
  edgesMtime: number;
  byId: Map<string, Entity>;
  searchIndex: Array<{ id: string; name: string; aliases: string[] }>;
  edgesFrom: Map<string, Edge[]>;
  edgesTo: Map<string, Edge[]>;
}

let cache: Cache | null = null;

function mtime(p: string): number {
  try { return fs.statSync(p).mtimeMs; } catch { return 0; }
}

function readJsonl<T>(p: string): T[] {
  if (!fs.existsSync(p)) return [];
  const out: T[] = [];
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { out.push(JSON.parse(s)); } catch { /* skip */ }
  }
  return out;
}

function readJson<T>(p: string): T | null {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) as T; } catch { return null; }
}

function primaryType(ent: Entity): string {
  const r = ent.resolved_type;
  if (Array.isArray(r)) return r[0] ?? ent.type;
  if (typeof r === 'string' && r) return r;
  return ent.type;
}

function loadCache(): Cache {
  const em = mtime(ENTITIES_PATH);
  const rm = mtime(RESOLVED_PATH);
  const dm = mtime(EDGES_PATH);

  if (cache && cache.entitiesMtime === em && cache.resolvedMtime === rm && cache.edgesMtime === dm) {
    return cache;
  }

  const byId = new Map<string, Entity>();
  for (const ent of readJsonl<Entity>(ENTITIES_PATH)) {
    byId.set(ent.id, { ...ent, aliases: ent.aliases ?? [], references: ent.references ?? [] });
  }

  interface Resolved {
    id: string;
    resolved_type?: string | string[];
    resolution_confidence?: 'high' | 'medium' | 'low';
    rule?: string;
    alternatives?: string[];
  }
  for (const r of readJsonl<Resolved>(RESOLVED_PATH)) {
    const ent = byId.get(r.id);
    if (!ent) continue;
    if (r.resolved_type !== undefined) ent.resolved_type = r.resolved_type;
    if (r.resolution_confidence !== undefined) ent.resolution_confidence = r.resolution_confidence;
    if (r.rule !== undefined) ent.resolution_rule = r.rule;
    if (r.alternatives !== undefined) ent.alternatives = r.alternatives;
  }

  const searchIndex: Cache['searchIndex'] = [];
  for (const ent of byId.values()) {
    searchIndex.push({
      id: ent.id,
      name: (ent.canonical_name ?? ent.id).toLowerCase(),
      aliases: (ent.aliases ?? []).map((a) => a.toLowerCase()),
    });
  }

  const edgesFrom = new Map<string, Edge[]>();
  const edgesTo = new Map<string, Edge[]>();
  for (const edge of readJsonl<Edge>(EDGES_PATH)) {
    const f = edgesFrom.get(edge.from) ?? [];
    f.push(edge);
    edgesFrom.set(edge.from, f);
    const t = edgesTo.get(edge.to) ?? [];
    t.push(edge);
    edgesTo.set(edge.to, t);
  }

  cache = { entitiesMtime: em, resolvedMtime: rm, edgesMtime: dm, byId, searchIndex, edgesFrom, edgesTo };
  return cache;
}

export function searchEntities(query: string, limit = 20): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const state = loadCache();

  const hits: Array<{ id: string; score: number; match: SearchHit['match'] }> = [];

  for (const entry of state.searchIndex) {
    let score = 0;
    let match: SearchHit['match'] = 'name';

    if (entry.name === q) score = 100;
    else if (entry.name.startsWith(q)) score = 80;
    else if (entry.name.includes(q)) score = 50;

    if (score === 0) {
      for (const a of entry.aliases) {
        if (!a) continue;
        if (a === q) { score = Math.max(score, 90); match = 'alias'; break; }
        if (a.startsWith(q)) { score = Math.max(score, 70); match = 'alias'; }
        else if (a.includes(q)) { score = Math.max(score, 40); match = 'alias'; }
      }
    }

    if (score === 0 && entry.id.toLowerCase().includes(q)) {
      score = 20; match = 'id';
    }

    if (score > 0) hits.push({ id: entry.id, score, match });
  }

  hits.sort((a, b) => b.score - a.score);

  return hits.slice(0, limit).map(({ id, match }) => {
    const ent = state.byId.get(id)!;
    return {
      id: ent.id,
      canonical_name: ent.canonical_name ?? ent.id,
      type: primaryType(ent),
      aliases: ent.aliases ?? [],
      reference_count: ent.references?.length ?? 0,
      match,
    };
  });
}

export function getEntityCard(
  id: string,
  opts: { neighborLimit?: number; weightThreshold?: number } = {},
): EntityCard | null {
  const { neighborLimit = 15, weightThreshold = 0.3 } = opts;
  const state = loadCache();
  const ent = state.byId.get(id);
  if (!ent) return null;

  const neighbors: Neighbor[] = [];
  const seen = new Set<string>();

  const collect = (edges: Edge[], direction: 'out' | 'in') => {
    for (const edge of edges) {
      const otherId = direction === 'out' ? edge.to : edge.from;
      const weight = edge.weight ?? 0;
      if (weight < weightThreshold) continue;
      const key = `${otherId}:${edge.type}:${direction}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const other = state.byId.get(otherId);
      neighbors.push({
        id: otherId,
        canonical_name: other?.canonical_name ?? otherId,
        type: other ? primaryType(other) : 'unknown',
        edge_type: edge.type,
        direction,
        weight,
        confidence: edge.confidence ?? 0,
      });
    }
  };

  collect(state.edgesFrom.get(id) ?? [], 'out');
  collect(state.edgesTo.get(id) ?? [], 'in');
  neighbors.sort((a, b) => b.weight - a.weight || b.confidence - a.confidence);

  return {
    id: ent.id,
    canonical_name: ent.canonical_name ?? ent.id,
    type: ent.type,
    resolved_type: ent.resolved_type,
    resolution_rule: ent.resolution_rule,
    resolution_confidence: ent.resolution_confidence,
    alternatives: ent.alternatives,
    aliases: ent.aliases ?? [],
    first_seen: ent.first_seen,
    last_referenced: ent.last_referenced,
    reference_count: ent.references?.length ?? 0,
    references: (ent.references ?? []).slice(0, 5),
    neighbors: neighbors.slice(0, neighborLimit),
  };
}

export function getKgStats(): { entities: number; edges: number; resolved: number; generated_at: string } {
  const state = loadCache();
  let resolved = 0;
  for (const ent of state.byId.values()) if (ent.resolved_type) resolved++;
  let edges = 0;
  for (const arr of state.edgesFrom.values()) edges += arr.length;
  return {
    entities: state.byId.size,
    edges,
    resolved,
    generated_at: new Date(Math.max(state.entitiesMtime, state.resolvedMtime, state.edgesMtime)).toISOString(),
  };
}

export function getKgOverview(opts: { graphLimit?: number } = {}): KgOverview {
  const graphLimit = Math.max(20, Math.min(opts.graphLimit ?? 120, 300));
  const state = loadCache();
  const conflicts = readJsonl<Conflict>(CONFLICTS_PATH);
  const manifest = readJson<Record<string, unknown>>(MANIFEST_PATH);

  const degree = new Map<string, number>();
  const edgeType = new Map<string, { count: number; confidence: number; weight: number }>();
  const detector = new Map<string, number>();
  let lowConfidenceEdges = 0;

  for (const arr of state.edgesFrom.values()) {
    for (const edge of arr) {
      degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
      degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
      const bucket = edgeType.get(edge.type) ?? { count: 0, confidence: 0, weight: 0 };
      bucket.count += 1;
      bucket.confidence += edge.confidence ?? 0;
      bucket.weight += edge.weight ?? edge.confidence ?? 0;
      edgeType.set(edge.type, bucket);
      detector.set(edge.detector ?? 'unknown', (detector.get(edge.detector ?? 'unknown') ?? 0) + 1);
      if ((edge.confidence ?? 0) < 0.6) lowConfidenceEdges++;
    }
  }

  const conflictByEntity = new Map<string, string[]>();
  for (const conflict of conflicts) {
    if (conflict.status && conflict.status !== 'pending') continue;
    for (const id of conflict.entities ?? []) {
      conflictByEntity.set(id, [...(conflictByEntity.get(id) ?? []), conflict.type]);
    }
  }

  const typeCounts = new Map<string, number>();
  const confidenceBands = new Map<string, number>([
    ['high', 0],
    ['medium', 0],
    ['low', 0],
    ['unknown', 0],
  ]);
  let resolved = 0;
  let orphanEntities = 0;
  let lowConfidenceEntities = 0;

  const entities = [...state.byId.values()];
  for (const ent of entities) {
    const type = primaryType(ent);
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);
    if (ent.resolved_type) resolved++;
    if ((degree.get(ent.id) ?? 0) === 0) orphanEntities++;
    const band = ent.resolution_confidence ?? 'unknown';
    confidenceBands.set(band, (confidenceBands.get(band) ?? 0) + 1);
    if (band === 'low') lowConfidenceEntities++;
  }

  const ranked = entities
    .map((ent) => ({
      id: ent.id,
      name: ent.canonical_name ?? ent.id,
      type: primaryType(ent),
      refs: ent.references?.length ?? 0,
      degree: degree.get(ent.id) ?? 0,
      confidence: ent.resolution_confidence,
    }))
    .sort((a, b) => b.degree - a.degree || b.refs - a.refs || a.name.localeCompare(b.name));

  const selected = new Set(ranked.slice(0, graphLimit).map((ent) => ent.id));
  const graphLinks: KgOverview['graph']['links'] = [];
  for (const arr of state.edgesFrom.values()) {
    for (const edge of arr) {
      if (!selected.has(edge.from) || !selected.has(edge.to)) continue;
      graphLinks.push({
        source: edge.from,
        target: edge.to,
        type: edge.type,
        weight: edge.weight ?? edge.confidence ?? 0,
        confidence: edge.confidence ?? 0,
        detector: edge.detector,
      });
    }
  }
  graphLinks.sort((a, b) => b.weight - a.weight || b.confidence - a.confidence);

  return {
    generated_at: new Date(Math.max(state.entitiesMtime, state.resolvedMtime, state.edgesMtime)).toISOString(),
    manifest,
    stats: {
      entities: state.byId.size,
      edges: [...state.edgesFrom.values()].reduce((sum, arr) => sum + arr.length, 0),
      resolved,
      conflicts: conflicts.length,
      pending_conflicts: conflicts.filter((c) => !c.status || c.status === 'pending').length,
      orphan_entities: orphanEntities,
      low_confidence_entities: lowConfidenceEntities,
      low_confidence_edges: lowConfidenceEdges,
    },
    type_counts: [...typeCounts.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count),
    edge_type_counts: [...edgeType.entries()].map(([type, bucket]) => ({
      type,
      count: bucket.count,
      avg_confidence: bucket.count ? bucket.confidence / bucket.count : 0,
      avg_weight: bucket.count ? bucket.weight / bucket.count : 0,
    })).sort((a, b) => b.count - a.count),
    confidence_bands: [...confidenceBands.entries()].map(([band, count]) => ({ band, count })),
    detector_counts: [...detector.entries()].map(([name, count]) => ({ detector: name, count })).sort((a, b) => b.count - a.count),
    top_entities: ranked.slice(0, 24),
    recent_entities: entities
      .map((ent) => ({
        id: ent.id,
        name: ent.canonical_name ?? ent.id,
        type: primaryType(ent),
        last_referenced: ent.last_referenced,
        refs: ent.references?.length ?? 0,
      }))
      .sort((a, b) => String(b.last_referenced ?? '').localeCompare(String(a.last_referenced ?? '')))
      .slice(0, 18),
    conflict_entities: [...conflictByEntity.entries()]
      .map(([id, conflictsForEntity]) => {
        const ent = state.byId.get(id);
        return {
          id,
          name: ent?.canonical_name ?? id,
          type: ent ? primaryType(ent) : 'unknown',
          conflicts: [...new Set(conflictsForEntity)],
        };
      })
      .slice(0, 18),
    graph: {
      nodes: ranked.slice(0, graphLimit).map((ent) => ({ ...ent, conflict: conflictByEntity.has(ent.id) })),
      links: graphLinks.slice(0, graphLimit * 4),
    },
  };
}
