#!/usr/bin/env -S node --loader tsx
/**
 * Register source files as entities — structural KG foundation.
 *
 * Walks memory/{library,topics,proposals,discussions}/**​/*.md, parses YAML
 * frontmatter, and registers each file as an entity via the registry.
 *
 * Why: frontmatter-edge builder needs `from` endpoints. Without source-file
 * entities, `authored_by` / `supersedes` are orphan edges. Per Kuro #105:
 * "沒 entity 邊就是孤兒，density 是 render-time filter 問題不是 topology 問題".
 *
 * Directory → type mapping:
 *   library/     → artifact  (subtype = frontmatter.type, e.g. blog/paper/book)
 *   topics/      → concept
 *   proposals/   → decision  (or claim if status=proposed; conservative: decision)
 *   discussions/ → event
 *
 * Idempotent: re-runs only add new files. Existing entities are left alone
 * (registry's resolveOrCreate handles dedupe via canonical_name + aliases).
 *
 * Usage:
 *   pnpm tsx scripts/kg-register-sources.ts          # dry-run, print stats
 *   pnpm tsx scripts/kg-register-sources.ts --write  # persist to entities.jsonl
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { KG_PATHS, type EntityType } from '../src/kg-types.js';
import { loadRegistry, persistRegistry, resolveOrCreate, type EntityCandidate } from '../src/kg-entity-registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const args = process.argv.slice(2);
const write = args.includes('--write');

const SOURCE_DIRS: Array<{ dir: string; type: EntityType; subtypeFromFm: boolean }> = [
  { dir: 'memory/library', type: 'artifact', subtypeFromFm: true },
  { dir: 'memory/topics', type: 'concept', subtypeFromFm: false },
  { dir: 'memory/proposals', type: 'decision', subtypeFromFm: false },
  { dir: 'memory/discussions', type: 'event', subtypeFromFm: false },
];

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
  const yamlBody = text.slice(4, end);
  try {
    const parsed = parseYaml(yamlBody);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// Build source_file → frontmatter chunk_id lookup (if chunks.jsonl exists).
function loadFrontmatterChunkIndex(): Map<string, string> {
  const idx = new Map<string, string>();
  const path = resolve(REPO_ROOT, KG_PATHS.chunks);
  if (!existsSync(path)) return idx;
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const c = JSON.parse(t);
      if (c.type === 'frontmatter' && c.source_file && !idx.has(c.source_file)) {
        idx.set(c.source_file, c.id);
      }
    } catch { /* skip */ }
  }
  return idx;
}

const fmChunkIndex = loadFrontmatterChunkIndex();
const reg = loadRegistry(resolve(REPO_ROOT, KG_PATHS.entities));
const before = reg.byId.size;
console.log(`Loaded ${before} existing entities`);
console.log(`Frontmatter chunks indexed: ${fmChunkIndex.size}`);

const now = new Date().toISOString();
let scanned = 0;
let withFrontmatter = 0;
let created = 0;
let enriched = 0;
const skipped: string[] = [];

for (const { dir, type, subtypeFromFm } of SOURCE_DIRS) {
  const root = resolve(REPO_ROOT, dir);
  const files = walkMd(root);
  for (const full of files) {
    scanned++;
    const rel = relative(REPO_ROOT, full);
    let text: string;
    try { text = readFileSync(full, 'utf-8'); } catch { skipped.push(`${rel} (read-fail)`); continue; }
    const fm = extractFrontmatter(text);
    if (!fm) {
      skipped.push(`${rel} (no-frontmatter)`);
      continue;
    }
    withFrontmatter++;

    // Fallback id = filename without .md extension. Proposals/topics often
    // rely on filename-as-id convention instead of explicit `id:` field.
    const fmId = typeof fm.id === 'string' && fm.id ? fm.id : basename(rel).replace(/\.md$/, '');
    const canonical = typeof fm.title === 'string' && fm.title.trim()
      ? fm.title.trim()
      : fmId;
    const subtype = subtypeFromFm && typeof fm.type === 'string' ? fm.type : undefined;
    const fmAliases = Array.isArray(fm.aliases) ? fm.aliases.filter((a): a is string => typeof a === 'string') : [];
    const aliases = [fmId, ...fmAliases];

    const candidate: EntityCandidate = {
      canonical_name: canonical,
      type,
      ...(subtype ? { subtype } : {}),
      aliases,
      meta: { source_file: rel, frontmatter_id: fmId },
    };

    const chunk_id = fmChunkIndex.get(rel) ?? `frontmatter:${rel}`;
    const result = resolveOrCreate(reg, candidate, chunk_id, now);
    if (result.created) created++;
    else if (result.enriched) enriched++;
  }
}

console.log(`\nScanned:         ${scanned} files`);
console.log(`With frontmatter: ${withFrontmatter}`);
console.log(`Skipped (no id): ${skipped.length}`);
console.log(`Created:         ${created} new entities`);
console.log(`Enriched:        ${enriched} existing entities`);
console.log(`Total now:       ${reg.byId.size} (was ${before})`);

if (skipped.length && skipped.length <= 10) {
  console.log(`\nSkipped files:\n  ${skipped.slice(0, 10).join('\n  ')}`);
}

if (!write) {
  console.log('\n(dry-run — pass --write to persist to entities.jsonl)');
  process.exit(0);
}

persistRegistry(reg, resolve(REPO_ROOT, KG_PATHS.entities));
console.log(`\nPersisted → ${KG_PATHS.entities}`);
