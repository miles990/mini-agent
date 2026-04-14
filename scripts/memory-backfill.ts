#!/usr/bin/env tsx
/**
 * Memory Layer v3 — Initial Backfill
 *
 * Compiles existing `memory/MEMORY.md` + `memory/topics/*.md` bullet-style
 * entries into `memory/index/entries.jsonl`.
 *
 * Idempotent: dedup by content_hash — re-running skips entries already compiled.
 * Attribution: "worker:memory-compiler@v1"
 *
 * Usage:
 *   tsx scripts/memory-backfill.ts [memoryDir] [--dry-run]
 *
 * Defaults to `./memory` relative to CWD.
 * `--dry-run` prints preview (source counts, dedup forecast, first 5 entries) without writing.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getEntriesStore, resetEntriesStore, computeContentHash } from '../src/entries.js';
import { compileRemember } from '../src/memory-compiler.js';

const BACKFILL_ATTRIBUTION = 'worker:memory-compiler@v1';

interface BulletEntry {
  content: string;
  source: string;         // e.g. "MEMORY.md" or "topics/mushi.md"
  topic?: string;         // e.g. "mushi"
}

function extractBullets(filePath: string, source: string, topic?: string): BulletEntry[] {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split('\n');
  const bullets: BulletEntry[] = [];

  let buffer = '';
  const flush = () => {
    const trimmed = buffer.trim();
    if (trimmed.length >= 10) bullets.push({ content: trimmed, source, topic });
    buffer = '';
  };

  for (const line of lines) {
    if (/^\s*-\s+/.test(line)) {
      // New bullet starts; flush previous
      if (buffer) flush();
      buffer = line.replace(/^\s*-\s+/, '').trim();
    } else if (/^\s{2,}\S/.test(line) && buffer) {
      // Continuation of prior bullet (indented)
      buffer += '\n' + line.trim();
    } else if (line.trim() === '' && buffer) {
      // Blank line ends bullet
      flush();
    } else if (/^#{1,6}\s/.test(line)) {
      // Heading — flush any pending bullet
      if (buffer) flush();
    }
  }
  if (buffer) flush();

  return bullets;
}

function parseArgs(argv: string[]): { memoryDir: string; dryRun: boolean } {
  const rest = argv.slice(2);
  const dryRun = rest.includes('--dry-run');
  const positional = rest.filter(a => !a.startsWith('--'));
  const memoryDir = path.resolve(positional[0] ?? './memory');
  return { memoryDir, dryRun };
}

function collectSources(memoryDir: string): { sources: BulletEntry[]; perSource: Map<string, number> } {
  const sources: BulletEntry[] = [];
  const perSource = new Map<string, number>();

  const memoryMd = path.join(memoryDir, 'MEMORY.md');
  const memBullets = extractBullets(memoryMd, 'MEMORY.md');
  sources.push(...memBullets);
  if (memBullets.length) perSource.set('MEMORY.md', memBullets.length);

  const topicsDir = path.join(memoryDir, 'topics');
  if (fs.existsSync(topicsDir)) {
    for (const file of fs.readdirSync(topicsDir)) {
      if (!file.endsWith('.md')) continue;
      const topic = file.replace(/\.md$/, '');
      const tBullets = extractBullets(path.join(topicsDir, file), `topics/${file}`, topic);
      sources.push(...tBullets);
      if (tBullets.length) perSource.set(`topics/${file}`, tBullets.length);
    }
  }
  return { sources, perSource };
}

function runDryRun(memoryDir: string): void {
  console.log(`[backfill:dry-run] memoryDir=${memoryDir}`);
  const store = getEntriesStore(memoryDir);
  const before = store.getStats();
  console.log(`[backfill:dry-run] current entries.jsonl: total=${before.total} active=${before.active}`);

  const { sources, perSource } = collectSources(memoryDir);
  console.log(`[backfill:dry-run] scanned ${sources.length} bullet entries from ${perSource.size} source files:`);
  for (const [src, count] of perSource) {
    console.log(`  - ${src}: ${count} bullets`);
  }

  // Simulate dedup without writing
  const seenHashes = new Set<string>();
  let wouldCompile = 0;
  let wouldSkipDedup = 0;
  const previewNew: BulletEntry[] = [];

  for (const s of sources) {
    const hash = computeContentHash(s.content);
    if (store.findByHash(hash) || seenHashes.has(hash)) {
      wouldSkipDedup++;
    } else {
      seenHashes.add(hash);
      wouldCompile++;
      if (previewNew.length < 5) previewNew.push(s);
    }
  }

  console.log(`[backfill:dry-run] forecast: would-compile=${wouldCompile} would-skip(dedup)=${wouldSkipDedup}`);
  console.log(`[backfill:dry-run] first ${previewNew.length} new entries:`);
  for (let i = 0; i < previewNew.length; i++) {
    const p = previewNew[i];
    const snippet = p.content.length > 140 ? p.content.slice(0, 140) + '…' : p.content;
    console.log(`  [${i + 1}] (${p.source}${p.topic ? ` topic=${p.topic}` : ''})`);
    console.log(`      ${snippet.replace(/\n/g, ' ⏎ ')}`);
  }
  console.log(`[backfill:dry-run] no writes performed. rerun without --dry-run to commit.`);
}

function runBackfill(memoryDir: string): void {
  console.log(`[backfill] starting from ${memoryDir}`);
  const store = getEntriesStore(memoryDir);
  const before = store.getStats();
  console.log(`[backfill] before: total=${before.total} active=${before.active}`);

  const { sources } = collectSources(memoryDir);
  console.log(`[backfill] scanned ${sources.length} bullet entries`);

  let compiled = 0;
  let skipped = 0;
  let failed = 0;

  for (const s of sources) {
    try {
      const entry = compileRemember({ memoryDir }, {
        content: s.content,
        topic: s.topic,
        source: s.source,
        attribution: BACKFILL_ATTRIBUTION,
      });
      if (entry) compiled++;
      else skipped++;
    } catch (e) {
      failed++;
      console.warn(`[backfill] failed: ${(e as Error).message}`);
    }
  }

  const after = store.getStats();
  console.log(`[backfill] done: compiled=${compiled} skipped(dedup)=${skipped} failed=${failed}`);
  console.log(`[backfill] after: total=${after.total} active=${after.active}`);
  console.log(`[backfill] entries.jsonl at ${path.join(memoryDir, 'index', 'entries.jsonl')}`);
}

function main(): void {
  const { memoryDir, dryRun } = parseArgs(process.argv);
  if (!fs.existsSync(memoryDir)) {
    console.error(`memory dir not found: ${memoryDir}`);
    process.exit(1);
  }
  resetEntriesStore();
  if (dryRun) runDryRun(memoryDir);
  else runBackfill(memoryDir);
}

main();
