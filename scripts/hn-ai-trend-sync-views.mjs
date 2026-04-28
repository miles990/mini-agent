#!/usr/bin/env node
/**
 * Single-source-of-truth view sync.
 *
 * graph.mjs is the canonical builder — it loads all sources, dedups, tags,
 * computes topSignals, and embeds the DATA payload into graph.html.
 *
 * swimlane.html and source-split.html are bespoke template files (different
 * D3 layout code, but consume the same DATA shape). This script keeps their
 * DATA line in lock-step with graph.html so all three views render the same
 * underlying data without drift.
 *
 * Run order:
 *   1. node scripts/hn-ai-trend-graph.mjs       # rebuild canonical DATA
 *   2. node scripts/hn-ai-trend-sync-views.mjs  # propagate to other views
 *
 * Falsifier (redline R1 — DATA parity):
 *   After running, the `const DATA = ...` line must be byte-equal across
 *   all three HTML files. This script asserts that on exit.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWS_DIR = join(__dirname, '..', 'kuro-portfolio', 'ai-trend');

const CANONICAL = join(VIEWS_DIR, 'graph.html');
const TARGETS = [
  join(VIEWS_DIR, 'swimlane.html'),
  join(VIEWS_DIR, 'source-split.html'),
];

// Match the `const DATA = {...};` injection line. Greedy match to end-of-line
// because the JSON is single-line by graph.mjs's contract (JSON.stringify
// without indent).
const DATA_LINE_RE = /^const DATA = \{.*\};$/m;

async function extractData(path) {
  const html = await readFile(path, 'utf8');
  const match = html.match(DATA_LINE_RE);
  if (!match) throw new Error(`No 'const DATA = {...};' line found in ${path}`);
  return match[0];
}

async function syncTarget(targetPath, canonicalLine) {
  const html = await readFile(targetPath, 'utf8');
  if (!DATA_LINE_RE.test(html)) {
    throw new Error(`Target ${targetPath} has no DATA line — template format unexpected`);
  }
  const updated = html.replace(DATA_LINE_RE, canonicalLine);
  if (updated === html) {
    console.log(`[sync] ${targetPath}: already in sync`);
    return false;
  }
  await writeFile(targetPath, updated, 'utf8');
  console.log(`[sync] ${targetPath}: updated`);
  return true;
}

async function main() {
  const canonical = await extractData(CANONICAL);
  console.log(`[sync] canonical DATA from graph.html (${canonical.length} bytes)`);

  for (const t of TARGETS) await syncTarget(t, canonical);

  // Parity assertion (R1)
  const lines = await Promise.all([CANONICAL, ...TARGETS].map(extractData));
  const allEqual = lines.every(l => l === lines[0]);
  if (!allEqual) {
    console.error('[sync] PARITY FAIL — DATA lines differ post-sync');
    process.exit(1);
  }
  console.log(`[sync] PARITY OK — ${lines.length} views share identical DATA`);
}

main().catch(err => { console.error(err); process.exit(1); });
