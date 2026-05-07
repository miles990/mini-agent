#!/usr/bin/env node
/**
 * rotate-decision-logs.mjs
 *
 * Generic JSONL log rotation for append-only decision/event logs.
 * Closes mini-agent#200.
 *
 * Strategy per file:
 *   1. If size <= MAX_SIZE_BYTES → skip
 *   2. If line count <= KEEP_LINES → skip (rare; one giant line)
 *   3. Keep newest KEEP_LINES in main file (append-only ⇒ tail = newest)
 *   4. Move overflow to memory/archive/<basename>-YYYYMMDD-HHMMSS.jsonl.gz (gzip)
 *
 * Idempotent + crash-safe: writes to *.tmp then atomically renames.
 *
 * Usage:
 *   node scripts/rotate-decision-logs.mjs            # rotate with defaults
 *   node scripts/rotate-decision-logs.mjs --dry-run  # show what would happen
 *   node scripts/rotate-decision-logs.mjs --max=2097152 --keep=2000
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const getNum = (flag, def) => {
  const a = args.find(x => x.startsWith(`--${flag}=`));
  return a ? parseInt(a.split('=')[1], 10) : def;
};

const MAX_SIZE_BYTES = getNum('max', 1024 * 1024);   // 1 MB
const KEEP_LINES = getNum('keep', 2000);              // newest N entries to keep in main

// Targets: relative to REPO_ROOT. Append-only JSONL only.
const TARGETS = [
  'memory/myelin-decisions.jsonl',
  'memory/myelin-routing-decisions.jsonl',
  'memory/myelin-workflow-decisions.jsonl',
  'memory/myelin-learning-decisions.jsonl',
  'memory/research-decisions.jsonl',
  'memory/state/decision-provenance.jsonl',
  'memory/state/commitments.jsonl',
  'memory/state/cascade-metrics.jsonl',
  'memory/state/cycle-nutrient.jsonl',
  'memory/state/task-events.jsonl',
  'memory/state/metabolism-log.jsonl',
];

const ARCHIVE_DIR = path.join(REPO_ROOT, 'memory', 'archive');

function ts() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function gzipBuffer(buf, outPath) {
  return new Promise((resolve, reject) => {
    zlib.gzip(buf, { level: 9 }, (err, result) => {
      if (err) return reject(err);
      try { fs.writeFileSync(outPath, result); resolve(); }
      catch (e) { reject(e); }
    });
  });
}

async function rotateOne(rel) {
  const abs = path.join(REPO_ROOT, rel);
  if (!fs.existsSync(abs)) return { rel, skipped: 'missing' };
  const stat = fs.statSync(abs);
  if (stat.size <= MAX_SIZE_BYTES) return { rel, skipped: 'under-threshold', size: stat.size };

  const raw = fs.readFileSync(abs, 'utf-8');
  const lines = raw.split('\n').filter(l => l.length > 0);
  if (lines.length <= KEEP_LINES) return { rel, skipped: 'few-lines', size: stat.size, lines: lines.length };

  // Append-only ⇒ tail = newest. Keep last KEEP_LINES, archive the rest.
  const archive = lines.slice(0, lines.length - KEEP_LINES);
  const keep = lines.slice(lines.length - KEEP_LINES);

  if (DRY_RUN) {
    return {
      rel, action: 'would-rotate',
      sizeBefore: stat.size, lines: lines.length,
      archiveLines: archive.length, keepLines: keep.length,
    };
  }

  if (!fs.existsSync(ARCHIVE_DIR)) fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

  const baseName = path.basename(rel, '.jsonl');
  const archiveName = `${baseName}-${ts()}.jsonl.gz`;
  const archivePath = path.join(ARCHIVE_DIR, archiveName);

  const archiveBuf = Buffer.from(archive.join('\n') + '\n', 'utf-8');
  await gzipBuffer(archiveBuf, archivePath);

  // Atomic write of remaining
  const tmp = abs + '.rotate.tmp';
  fs.writeFileSync(tmp, keep.join('\n') + '\n');
  fs.renameSync(tmp, abs);

  return {
    rel, action: 'rotated',
    sizeBefore: stat.size,
    sizeAfter: fs.statSync(abs).size,
    archivePath: path.relative(REPO_ROOT, archivePath),
    archiveSize: fs.statSync(archivePath).size,
    archiveLines: archive.length, keepLines: keep.length,
  };
}

async function main() {
  const results = [];
  for (const t of TARGETS) {
    try { results.push(await rotateOne(t)); }
    catch (err) { results.push({ rel: t, error: String(err?.message || err) }); }
  }
  process.stdout.write(JSON.stringify({
    ts: new Date().toISOString(),
    dryRun: DRY_RUN,
    maxSizeBytes: MAX_SIZE_BYTES,
    keepLines: KEEP_LINES,
    rotated: results.filter(r => r.action === 'rotated').length,
    skipped: results.filter(r => r.skipped).length,
    errors: results.filter(r => r.error).length,
    results,
  }, null, 2) + '\n');
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
