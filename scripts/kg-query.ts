#!/usr/bin/env -S node --loader tsx
/**
 * KG Query CLI.
 *
 * Usage:
 *   pnpm tsx scripts/kg-query.ts "Claude Code" "mini-agent"
 *   pnpm tsx scripts/kg-query.ts --json "Kuro"
 *   pnpm tsx scripts/kg-query.ts --top 30 --drop-mentions "PPR"
 */

import { query, formatReport } from '../src/kg-query.js';

const args = process.argv.slice(2);
const asJson = args.includes('--json');
const dropMentions = args.includes('--drop-mentions');
const topIdx = args.indexOf('--top');
const topK = topIdx >= 0 ? parseInt(args[topIdx + 1], 10) : 20;

const probes = args.filter((a, i) => {
  if (a.startsWith('--')) return false;
  if (i > 0 && args[i - 1] === '--top') return false;
  return true;
});

if (probes.length === 0) {
  console.error('Usage: kg-query.ts [--json] [--drop-mentions] [--top N] <probe> [<probe>...]');
  process.exit(1);
}

const report = query(probes, {
  topK,
  loader: dropMentions ? { dropMentions: true } : {},
});

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatReport(report));
}
