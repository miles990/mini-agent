#!/usr/bin/env -S node --loader tsx
/**
 * KG Chunk Extractor (P1b) — runs chunkMarkdown over SCAN_DIRS, writes chunks.jsonl.
 *
 * Pairs with kg-extract-links.ts: same walk/SCAN_DIRS/TOP_LEVEL_FILES conventions
 * so link extractor and chunk extractor see the same file universe. Pure rebuild
 * target — output is fully reproducible from raw markdown.
 *
 * Usage: pnpm tsx scripts/kg-extract-chunks.ts [--dry] [--include-archive]
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KG_PATHS } from '../src/kg-types.js';
import { chunkMarkdown } from '../src/kg-chunker.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const includeArchive = args.includes('--include-archive');

const SCAN_DIRS = [
  'memory/library',
  'memory/topics',
  'memory/threads',
  'memory/proposals',
  'memory/conversations',
  'memory/discussions',
  'memory/handoffs',
  'memory/daily',
  'memory/docs',
  'memory/learning',
  'memory/drafts',
  'memory/evolution-tracks',
];
const ARCHIVE_DIRS = ['memory/archive', 'memory/archived'];
const TOP_LEVEL_FILES = [
  'memory/MEMORY.md',
  'memory/SOUL.md',
  'memory/HEARTBEAT.md',
  'memory/NEXT.md',
  'memory/inner-notes.md',
  'memory/inner-voice.md',
  'memory/ARCHITECTURE.md',
  'memory/backlog.md',
  'memory/behavior.md',
  'memory/cold-storage.md',
  'memory/contradiction-report.md',
];
const SKIP_DIRS = new Set(['index', 'state', 'context-checkpoints', 'lane-output', 'inbox', '__pycache__']);

function* walk(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (st.isFile() && name.endsWith('.md')) yield full;
  }
}

const now = new Date().toISOString();
const allLines: string[] = [];
const byType: Record<string, number> = {};
const bySource: Record<string, number> = {};
let filesScanned = 0;
let bytesTotal = 0;

function ingest(absPath: string) {
  const rel = relative(REPO_ROOT, absPath);
  const content = readFileSync(absPath, 'utf-8');
  bytesTotal += Buffer.byteLength(content, 'utf-8');
  filesScanned++;
  const chunks = chunkMarkdown(rel, content, { now });
  for (const c of chunks) {
    allLines.push(JSON.stringify(c));
    byType[c.type] = (byType[c.type] ?? 0) + 1;
  }
  const topDir = rel.split('/').slice(0, 2).join('/');
  bySource[topDir] = (bySource[topDir] ?? 0) + chunks.length;
}

const dirsToScan = includeArchive ? [...SCAN_DIRS, ...ARCHIVE_DIRS] : SCAN_DIRS;
for (const dir of dirsToScan) {
  const abs = resolve(REPO_ROOT, dir);
  for (const file of walk(abs)) ingest(file);
}

for (const f of TOP_LEVEL_FILES) {
  const abs = resolve(REPO_ROOT, f);
  if (existsSync(abs)) ingest(abs);
}

allLines.sort((a, b) => {
  const pa = JSON.parse(a) as { source_file: string; line_range: [number, number] };
  const pb = JSON.parse(b) as { source_file: string; line_range: [number, number] };
  if (pa.source_file !== pb.source_file) return pa.source_file.localeCompare(pb.source_file);
  return pa.line_range[0] - pb.line_range[0];
});

const outPath = resolve(REPO_ROOT, KG_PATHS.chunks);
const payload = allLines.join('\n') + (allLines.length ? '\n' : '');

if (dry) {
  console.log(`[dry] would write ${allLines.length} chunks from ${filesScanned} files to ${relative(REPO_ROOT, outPath)}`);
} else {
  writeFileSync(outPath, payload);
  console.log(`Wrote ${allLines.length} chunks from ${filesScanned} files (${(bytesTotal / 1024).toFixed(1)} KB raw) → ${relative(REPO_ROOT, outPath)}`);
}

console.log(`  by type: ${JSON.stringify(byType)}`);
const topSources = Object.entries(bySource)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 8)
  .map(([k, v]) => `${k}=${v}`)
  .join(' ');
console.log(`  top dirs: ${topSources}`);
