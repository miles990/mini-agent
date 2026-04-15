#!/usr/bin/env -S node --loader tsx
/**
 * Frontmatter structural edges — rule-based from YAML frontmatter.
 *
 * Two high-signal edge types today (per Kuro #105):
 *   authored_by  <source-file-entity> → <actor>   (from `author: ...`)
 *   supersedes   <new-entity> → <old-entity>      (from topic `superseded_by:`)
 *
 * Why structural: frontmatter claims are author-declared facts, not inferred.
 * Rule-based detection (no LLM) → confidence=1.0, weight=1.0 (full walk
 * preference, unlike co-occurrence's 0.3).
 *
 * Depends on: kg-register-sources.ts having run first so source files exist
 * as entities. Missing `from` endpoint → edge is skipped (not an error).
 *
 * Actor resolution: `author` string → look up via aliasIndex. Miss → register
 * new actor (structural fact; reasonable to synthesize from frontmatter).
 *
 * Idempotent: dedup on (from, to, type). Safe to re-run.
 *
 * Usage:
 *   pnpm tsx scripts/kg-build-frontmatter-edges.ts             # dry-run
 *   pnpm tsx scripts/kg-build-frontmatter-edges.ts --write     # append to edges.jsonl
 *   pnpm tsx scripts/kg-build-frontmatter-edges.ts --replace-frontmatter  # replace only frontmatter detector edges
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { KG_PATHS, type EdgeRecord, type IndexManifest } from '../src/kg-types.js';
import {
  loadRegistry,
  persistRegistry,
  resolveOrCreate,
  findExisting,
} from '../src/kg-entity-registry.js';
import { persistEdges } from '../src/kg-edge-builder.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const args = process.argv.slice(2);
const write = args.includes('--write');
const replaceFm = args.includes('--replace-frontmatter');

const SOURCE_DIRS = ['memory/library', 'memory/topics', 'memory/proposals', 'memory/discussions'];

function walkMd(root: string): string[] {
  const out: string[] = [];
  if (!existsSync(root)) return out;
  for (const name of readdirSync(root)) {
    const full = join(root, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walkMd(full));
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}

function extractFrontmatter(text: string): Record<string, unknown> | null {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) return null;
  const end = text.indexOf('\n---', 4);
  if (end === -1) return null;
  try {
    const parsed = parseYaml(text.slice(4, end));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const entitiesPath = resolve(REPO_ROOT, KG_PATHS.entities);
const edgesPath = resolve(REPO_ROOT, KG_PATHS.edges);
const manifestPath = resolve(REPO_ROOT, KG_PATHS.manifest);

const reg = loadRegistry(entitiesPath);
console.log(`Loaded ${reg.byId.size} entities`);

const now = new Date().toISOString();
const newEdges: EdgeRecord[] = [];
let authoredByCount = 0;
let supersedesCount = 0;
let actorsCreated = 0;
const unresolvedAuthors: string[] = [];
const unresolvedSupersedes: string[] = [];

for (const dir of SOURCE_DIRS) {
  const root = resolve(REPO_ROOT, dir);
  const files = walkMd(root);
  for (const full of files) {
    const rel = relative(REPO_ROOT, full);
    let text: string;
    try { text = readFileSync(full, 'utf-8'); } catch { continue; }
    const fm = extractFrontmatter(text);
    if (!fm) continue;

    const selfProbe = typeof fm.id === 'string' ? fm.id : rel.replace(/^.*\//, '').replace(/\.md$/, '');
    const self = findExisting(reg, { canonical_name: selfProbe, type: 'artifact' });
    if (!self) continue;  // register-sources should have created it; skip gracefully

    // ── authored_by ──
    if (typeof fm.author === 'string' && fm.author.trim()) {
      const authorName = fm.author.trim();
      let actor = findExisting(reg, { canonical_name: authorName, type: 'actor' });
      if (!actor) {
        // Synthesize actor from frontmatter. Structural fact: someone wrote this.
        const chunkId = `frontmatter:${rel}`;
        const result = resolveOrCreate(reg, {
          canonical_name: authorName,
          type: 'actor',
          meta: { source: 'frontmatter' },
        }, chunkId, now);
        if (result.created) actorsCreated++;
        actor = reg.byId.get(result.id);
      }
      if (actor) {
        newEdges.push({
          from: self.id,
          to: actor.id,
          type: 'authored_by',
          confidence: 1.0,
          weight: 1.0,  // structural fact — full walk preference
          detector: 'rule',
          evidence_chunk_id: `frontmatter:${rel}`,
          evidence_quote: `author: ${authorName}`,
          created: now,
        });
        authoredByCount++;
      } else {
        unresolvedAuthors.push(`${rel} → ${authorName}`);
      }
    }

    // ── supersedes ──
    // topic.superseded_by = "<id-of-replacement>"  →  replacement supersedes self
    if (typeof fm.superseded_by === 'string' && fm.superseded_by.trim()) {
      const replacementId = fm.superseded_by.trim();
      const replacement = findExisting(reg, { canonical_name: replacementId, type: 'concept' });
      if (replacement) {
        newEdges.push({
          from: replacement.id,
          to: self.id,
          type: 'supersedes',
          confidence: 1.0,
          weight: 1.0,
          detector: 'rule',
          evidence_chunk_id: `frontmatter:${rel}`,
          evidence_quote: `superseded_by: ${replacementId}`,
          created: now,
        });
        supersedesCount++;
      } else {
        unresolvedSupersedes.push(`${rel} → ${replacementId}`);
      }
    }
  }
}

// Dedup the run's own output by (from, to, type).
const dedup = new Map<string, EdgeRecord>();
for (const e of newEdges) dedup.set(`${e.from}\t${e.to}\t${e.type}`, e);
const edges = [...dedup.values()];

console.log(`\nauthored_by edges: ${authoredByCount}`);
console.log(`supersedes edges:  ${supersedesCount}`);
console.log(`actors synthesized: ${actorsCreated}`);
console.log(`Deduped total:     ${edges.length}`);
if (unresolvedAuthors.length) console.log(`Unresolved authors: ${unresolvedAuthors.length} (first 3): ${unresolvedAuthors.slice(0, 3).join(' | ')}`);
if (unresolvedSupersedes.length) console.log(`Unresolved supersedes: ${unresolvedSupersedes.length}: ${unresolvedSupersedes.slice(0, 3).join(' | ')}`);

if (!write && !replaceFm) {
  console.log('\n(dry-run — pass --write to append or --replace-frontmatter to replace frontmatter-detector edges)');
  process.exit(0);
}

// Load existing edges and merge/replace.
const existing: EdgeRecord[] = [];
if (existsSync(edgesPath)) {
  for (const line of readFileSync(edgesPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try { existing.push(JSON.parse(t)); } catch { /* skip */ }
  }
}

const merged = new Map<string, EdgeRecord>();
for (const e of existing) {
  // --replace-frontmatter drops prior frontmatter-detector edges so stale ones
  // don't accumulate. detector='rule' alone isn't enough (co-occurrence shares
  // it); use evidence_chunk_id prefix as the frontmatter marker.
  if (replaceFm && e.evidence_chunk_id?.startsWith('frontmatter:')) continue;
  merged.set(`${e.from}\t${e.to}\t${e.type}`, e);
}

let added = 0;
for (const e of edges) {
  const key = `${e.from}\t${e.to}\t${e.type}`;
  if (!merged.has(key)) { merged.set(key, e); added++; }
}

persistEdges([...merged.values()], edgesPath);
console.log(`\nAppended ${added} new edges (total ${merged.size}) → ${edgesPath}`);

if (actorsCreated > 0) {
  persistRegistry(reg, entitiesPath);
  console.log(`Persisted ${reg.byId.size} entities (+${actorsCreated} actors)`);
}

// Sync manifest.
let manifest: IndexManifest;
if (existsSync(manifestPath)) {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
} else {
  manifest = {
    version: 1, built_at: now, raw_files_count: 0, raw_bytes_total: 0,
    entities_count: reg.byId.size, edges_count: 0, chunks_count: 0,
    conflicts_pending: 0, last_full_rebuild: 'never', last_incremental: now,
  };
}
manifest.edges_count = merged.size;
manifest.entities_count = reg.byId.size;
manifest.last_incremental = now;
manifest.built_at = now;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Synced manifest: edges=${merged.size} entities=${reg.byId.size}`);
