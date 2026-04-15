#!/usr/bin/env -S node --loader tsx
/**
 * KG Link Extractor (P1a, syntactic) — pure deterministic.
 *
 * Walks raw markdown layer and extracts every `[text](path)` and `[[wikilink]]`
 * to memory/index/links-raw.jsonl. No entity resolution — that's P1c's job
 * once the entity registry exists. Each line:
 *   { source, source_line, kind, text, target, target_anchor? }
 *
 * Confidence is implicit 1.0 (regex-extracted, not inferred). External URLs
 * (http://, https://, mailto:) are kept — they become `sourced_from` candidates
 * later but here we only record presence.
 *
 * Usage: pnpm tsx scripts/kg-extract-links.ts [--root memory] [--dry]
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KG_PATHS } from '../src/kg-types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const includeArchive = args.includes('--include-archive');
const rootIdx = args.indexOf('--root');
const ROOT = rootIdx >= 0 ? args[rootIdx + 1] : 'memory';

// Directories to walk (relative to repo root). Skip derived/index/state.
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

// Skip directories that contain derived data, state, or non-content.
const SKIP_DIRS = new Set(['index', 'state', 'context-checkpoints', 'lane-output', 'inbox', '__pycache__']);

type TargetKind = 'internal' | 'external' | 'wikilink' | 'mailto';

interface RawLink {
  source: string;          // repo-relative path
  source_line: number;     // 1-based
  kind: 'markdown' | 'wikilink' | 'reference-style';
  text: string;            // visible link text
  target: string;          // raw link target (path or URL or wikilink id)
  target_kind: TargetKind; // pre-classified for P1c resolver
  target_anchor?: string;  // #section if present
}

function classifyTarget(target: string, kind: RawLink['kind']): TargetKind {
  if (kind === 'wikilink') return 'wikilink';
  if (target.startsWith('mailto:')) return 'mailto';
  if (/^https?:/.test(target)) return 'external';
  return 'internal';
}

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

// Inline markdown links: [text](target). Skip image refs (preceded by `!`).
const MD_LINK_RE = /(?<!!)\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
// Wikilinks: [[id]] or [[id|alias]]
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

function splitAnchor(target: string): { target: string; anchor?: string } {
  const i = target.indexOf('#');
  if (i < 0) return { target };
  return { target: target.slice(0, i), anchor: target.slice(i + 1) };
}

function extractLinks(file: string): RawLink[] {
  const rel = relative(REPO_ROOT, file);
  const text = readFileSync(file, 'utf-8');
  const lines = text.split('\n');
  const out: RawLink[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m: RegExpExecArray | null;

    MD_LINK_RE.lastIndex = 0;
    while ((m = MD_LINK_RE.exec(line)) !== null) {
      const { target, anchor } = splitAnchor(m[2]);
      out.push({
        source: rel,
        source_line: i + 1,
        kind: 'markdown',
        text: m[1],
        target,
        target_kind: classifyTarget(target, 'markdown'),
        ...(anchor ? { target_anchor: anchor } : {}),
      });
    }

    WIKILINK_RE.lastIndex = 0;
    while ((m = WIKILINK_RE.exec(line)) !== null) {
      out.push({
        source: rel,
        source_line: i + 1,
        kind: 'wikilink',
        text: m[2] ?? m[1],
        target: m[1],
        target_kind: classifyTarget(m[1], 'wikilink'),
      });
    }
  }

  return out;
}

const allLinks: RawLink[] = [];
const filesScanned: string[] = [];

const dirsToScan = includeArchive ? [...SCAN_DIRS, ...ARCHIVE_DIRS] : SCAN_DIRS;
for (const dir of dirsToScan) {
  const abs = resolve(REPO_ROOT, dir);
  for (const file of walk(abs)) {
    filesScanned.push(file);
    allLinks.push(...extractLinks(file));
  }
}

for (const f of TOP_LEVEL_FILES) {
  const abs = resolve(REPO_ROOT, f);
  if (existsSync(abs)) {
    filesScanned.push(abs);
    allLinks.push(...extractLinks(abs));
  }
}

// Stable sort: by source path then line. Makes diffs reviewable.
allLinks.sort((a, b) =>
  a.source === b.source ? a.source_line - b.source_line : a.source.localeCompare(b.source)
);

const outPath = resolve(REPO_ROOT, KG_PATHS.dir, 'links-raw.jsonl');
const payload = allLinks.map((l) => JSON.stringify(l)).join('\n') + (allLinks.length ? '\n' : '');

if (dry) {
  console.log(`[dry] would write ${allLinks.length} links from ${filesScanned.length} files to ${relative(REPO_ROOT, outPath)}`);
} else {
  writeFileSync(outPath, payload);
  console.log(`Wrote ${allLinks.length} links from ${filesScanned.length} files → ${relative(REPO_ROOT, outPath)}`);
}

// Tally for visibility
const byKind = allLinks.reduce<Record<string, number>>((acc, l) => {
  acc[l.kind] = (acc[l.kind] ?? 0) + 1;
  return acc;
}, {});
const externalCount = allLinks.filter((l) => /^(https?:|mailto:)/.test(l.target)).length;
console.log(`  by kind: ${JSON.stringify(byKind)}`);
console.log(`  external URLs: ${externalCount} | internal: ${allLinks.length - externalCount}`);
