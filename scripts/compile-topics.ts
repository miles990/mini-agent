#!/usr/bin/env -S node --loader tsx
/**
 * Dual-audience topic compiler v0.1
 *
 * Auto-populates HEADER (partial) + FOOTER for topic files marked with
 * dual-audience delimiters. Narrative body between delimiters is never touched.
 *
 * Markers (exact strings):
 *   <!-- ===== DUAL-AUDIENCE HEADER (compile-target, manual v0) ===== -->
 *   <!-- ===== NARRATIVE BODY (human-owned, compile does NOT touch) ===== -->
 *   <!-- ===== DUAL-AUDIENCE FOOTER (compile-target, manual v0) ===== -->
 *
 * v0.1 scope:
 *   - populate connected concepts from edges.jsonl outgoing edges
 *   - update footer last_compiled + source_chunks count
 *   - leave entity_ids pending-register list untouched (P1b: ingest)
 *   - leave 30-sec summary untouched (P1c: LLM-gen + pin)
 *
 * Usage:
 *   pnpm tsx scripts/compile-topics.ts                        # dry-run all topics
 *   pnpm tsx scripts/compile-topics.ts --write                # persist changes
 *   pnpm tsx scripts/compile-topics.ts --topic <slug> --write # single topic
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const TOPICS_DIR = resolve(REPO_ROOT, 'memory/topics');
const ENTITIES_PATH = resolve(REPO_ROOT, 'memory/index/entities.jsonl');
const EDGES_PATH = resolve(REPO_ROOT, 'memory/index/edges.jsonl');
const CHUNKS_PATH = resolve(REPO_ROOT, 'memory/index/chunks.jsonl');

const HEADER_MARKER = '<!-- ===== DUAL-AUDIENCE HEADER (compile-target, manual v0) ===== -->';
const BODY_MARKER = '<!-- ===== NARRATIVE BODY (human-owned, compile does NOT touch) ===== -->';
const FOOTER_MARKER = '<!-- ===== DUAL-AUDIENCE FOOTER (compile-target, manual v0) ===== -->';

const args = process.argv.slice(2);
const write = args.includes('--write');
const topicIdx = args.indexOf('--topic');
const singleTopic = topicIdx >= 0 ? args[topicIdx + 1] : null;

type Entity = {
  id: string;
  type: string;
  canonical_name: string;
  aliases?: string[];
};

type Edge = {
  from: string;
  to: string;
  type: string;
  confidence?: number;
};

function loadJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, 'utf-8');
  const out: T[] = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as T);
    } catch {
      // skip malformed
    }
  }
  return out;
}

function topicSlug(filename: string): string {
  return basename(filename, '.md');
}

function topicEntityId(slug: string): string {
  return `ent-${slug}`;
}

function countSourceChunks(chunksRaw: string, slug: string): number {
  const needle = `memory/topics/${slug}.md`;
  let n = 0;
  for (const line of chunksRaw.split('\n')) {
    if (line.includes(needle)) n++;
  }
  return n;
}

function renderConnectedConcepts(
  edges: Edge[],
  entities: Map<string, Entity>,
  topicEntId: string
): string | null {
  const outgoing = edges.filter((e) => e.from === topicEntId);
  if (outgoing.length === 0) {
    // human-curated list wins over auto-empty; compile leaves header alone.
    return null;
  }
  const byType = new Map<string, Edge[]>();
  for (const e of outgoing) {
    if (!byType.has(e.type)) byType.set(e.type, []);
    byType.get(e.type)!.push(e);
  }
  const lines: string[] = [];
  for (const [type, es] of byType) {
    for (const e of es) {
      const tgt = entities.get(e.to);
      const label = tgt ? tgt.canonical_name : e.to;
      lines.push(`- → ${type}: \`${e.to}\` (${label})`);
    }
  }
  return lines.join('\n');
}

function compileFooter(
  existingFooter: string,
  slug: string,
  sourceChunkCount: number
): string {
  const lines = existingFooter.split('\n');
  const now = new Date().toISOString();
  const out: string[] = [];
  let rewroteCompiled = false;
  let rewroteChunks = false;
  for (const line of lines) {
    if (line.startsWith('**last_compiled**')) {
      out.push(`**last_compiled**: ${now} (auto, compile-topics v0.1)`);
      rewroteCompiled = true;
    } else if (line.startsWith('**source_chunks**')) {
      out.push(
        `**source_chunks**: ${sourceChunkCount} chunks (grep \`source_file=memory/topics/${slug}.md\` in chunks.jsonl)`
      );
      rewroteChunks = true;
    } else {
      out.push(line);
    }
  }
  if (!rewroteCompiled) {
    out.unshift(`**last_compiled**: ${now} (auto, compile-topics v0.1)`);
  }
  if (!rewroteChunks) {
    out.splice(1, 0, `**source_chunks**: ${sourceChunkCount} chunks`);
  }
  return out.join('\n');
}

function replaceConnectedConceptsInHeader(header: string, rendered: string): string {
  // Header contains: **connected concepts** (from `edges.jsonl`, human-readable)
  // followed by a list of `- ...` lines, until blank line or end of header.
  const lines = header.split('\n');
  const out: string[] = [];
  let inBlock = false;
  let skippingList = false;
  for (const line of lines) {
    if (line.startsWith('**connected concepts**')) {
      out.push(line);
      out.push(rendered);
      inBlock = true;
      skippingList = true;
      continue;
    }
    if (skippingList) {
      if (line.startsWith('- ') || line.trim() === '') {
        if (line.trim() === '') {
          skippingList = false;
          out.push(line);
        }
        // else: skip existing list item
        continue;
      }
      skippingList = false;
    }
    out.push(line);
  }
  if (!inBlock) {
    // header has no connected concepts section — do not invent one
    return header;
  }
  return out.join('\n');
}

type CompileResult = {
  file: string;
  slug: string;
  changed: boolean;
  reason?: string;
  diff?: { connected: boolean; footer: boolean };
};

function compileOne(
  filePath: string,
  edges: Edge[],
  entities: Map<string, Entity>,
  chunksRaw: string
): CompileResult {
  const slug = topicSlug(filePath);
  const raw = readFileSync(filePath, 'utf-8');
  const hIdx = raw.indexOf(HEADER_MARKER);
  const bIdx = raw.indexOf(BODY_MARKER);
  const fIdx = raw.indexOf(FOOTER_MARKER);
  if (hIdx < 0 || bIdx < 0 || fIdx < 0) {
    return { file: filePath, slug, changed: false, reason: 'no-markers' };
  }
  if (!(hIdx < bIdx && bIdx < fIdx)) {
    return { file: filePath, slug, changed: false, reason: 'marker-order-invalid' };
  }

  const prelude = raw.slice(0, hIdx + HEADER_MARKER.length);
  const header = raw.slice(hIdx + HEADER_MARKER.length, bIdx);
  const bodyMarkerAndBody = raw.slice(bIdx, fIdx);
  const footer = raw.slice(fIdx + FOOTER_MARKER.length);

  const entId = topicEntityId(slug);
  const rendered = renderConnectedConcepts(edges, entities, entId);
  const newHeader =
    rendered === null ? header : replaceConnectedConceptsInHeader(header, rendered);
  const newFooter = compileFooter(footer, slug, countSourceChunks(chunksRaw, slug));

  const next =
    prelude + newHeader + bodyMarkerAndBody + FOOTER_MARKER + newFooter;

  if (next === raw) {
    return { file: filePath, slug, changed: false, reason: 'no-change' };
  }
  return {
    file: filePath,
    slug,
    changed: true,
    diff: {
      connected: newHeader !== header,
      footer: newFooter !== footer,
    },
    ...(write ? {} : {}),
  };
}

function applyCompile(
  filePath: string,
  edges: Edge[],
  entities: Map<string, Entity>,
  chunksRaw: string
): void {
  const slug = topicSlug(filePath);
  const raw = readFileSync(filePath, 'utf-8');
  const hIdx = raw.indexOf(HEADER_MARKER);
  const bIdx = raw.indexOf(BODY_MARKER);
  const fIdx = raw.indexOf(FOOTER_MARKER);

  const prelude = raw.slice(0, hIdx + HEADER_MARKER.length);
  const header = raw.slice(hIdx + HEADER_MARKER.length, bIdx);
  const bodyMarkerAndBody = raw.slice(bIdx, fIdx);
  const footer = raw.slice(fIdx + FOOTER_MARKER.length);

  const entId = topicEntityId(slug);
  const rendered = renderConnectedConcepts(edges, entities, entId);
  const newHeader =
    rendered === null ? header : replaceConnectedConceptsInHeader(header, rendered);
  const newFooter = compileFooter(footer, slug, countSourceChunks(chunksRaw, slug));

  const next =
    prelude + newHeader + bodyMarkerAndBody + FOOTER_MARKER + newFooter;
  writeFileSync(filePath, next);
}

function main(): void {
  if (!existsSync(TOPICS_DIR)) {
    console.error(`No topics dir: ${TOPICS_DIR}`);
    process.exit(1);
  }
  const entities = new Map<string, Entity>();
  for (const e of loadJsonl<Entity>(ENTITIES_PATH)) entities.set(e.id, e);
  const edges = loadJsonl<Edge>(EDGES_PATH);
  const chunksRaw = existsSync(CHUNKS_PATH) ? readFileSync(CHUNKS_PATH, 'utf-8') : '';

  const files = singleTopic
    ? [resolve(TOPICS_DIR, `${singleTopic}.md`)]
    : readdirSync(TOPICS_DIR)
        .filter((f) => f.endsWith('.md'))
        .map((f) => resolve(TOPICS_DIR, f));

  let compiled = 0;
  let skipped = 0;
  const results: CompileResult[] = [];
  for (const file of files) {
    if (!existsSync(file)) {
      console.error(`skip: ${file} (not found)`);
      continue;
    }
    const r = compileOne(file, edges, entities, chunksRaw);
    results.push(r);
    if (r.changed) {
      compiled++;
      if (write) applyCompile(file, edges, entities, chunksRaw);
    } else {
      skipped++;
    }
  }

  console.log(
    `\n[compile-topics v0.1] ${write ? 'WRITE' : 'DRY-RUN'} — ${compiled} changed, ${skipped} skipped (${results.length} total)\n`
  );
  for (const r of results) {
    const tag = r.changed ? (write ? 'WROTE' : 'WOULD-WRITE') : 'SKIP';
    const why = r.reason ? ` [${r.reason}]` : '';
    const diff = r.diff
      ? ` (connected=${r.diff.connected}, footer=${r.diff.footer})`
      : '';
    console.log(`  ${tag.padEnd(12)} ${r.slug}${why}${diff}`);
  }
  if (!write && compiled > 0) {
    console.log('\nRerun with --write to persist.');
  }
}

main();
