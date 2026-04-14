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
 *   tsx scripts/memory-backfill.ts [memoryDir]
 *
 * Defaults to `./memory` relative to CWD.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getEntriesStore, resetEntriesStore } from '../src/entries.js';
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

function main(): void {
  const memoryDir = path.resolve(process.argv[2] ?? './memory');
  if (!fs.existsSync(memoryDir)) {
    console.error(`memory dir not found: ${memoryDir}`);
    process.exit(1);
  }

  console.log(`[backfill] starting from ${memoryDir}`);
  resetEntriesStore();
  const store = getEntriesStore(memoryDir);
  const before = store.getStats();
  console.log(`[backfill] before: total=${before.total} active=${before.active}`);

  const sources: BulletEntry[] = [];

  // MEMORY.md
  const memoryMd = path.join(memoryDir, 'MEMORY.md');
  sources.push(...extractBullets(memoryMd, 'MEMORY.md'));

  // topics/*.md
  const topicsDir = path.join(memoryDir, 'topics');
  if (fs.existsSync(topicsDir)) {
    for (const file of fs.readdirSync(topicsDir)) {
      if (!file.endsWith('.md')) continue;
      const topic = file.replace(/\.md$/, '');
      sources.push(...extractBullets(path.join(topicsDir, file), `topics/${file}`, topic));
    }
  }

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

main();
