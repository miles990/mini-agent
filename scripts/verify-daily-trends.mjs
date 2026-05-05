#!/usr/bin/env node
// verify-daily-trends.mjs — sanity check that today's trend files exist and look healthy.
// Exit 0 = all good. Exit 1 = at least one trend missing or suspiciously small.
// Use: node scripts/verify-daily-trends.mjs [--date=YYYY-MM-DD]
import fs from 'node:fs';
import path from 'node:path';

const arg = process.argv.find(a => a.startsWith('--date='));
const today = arg ? arg.slice(7) : new Date().toISOString().slice(0, 10);

// trend → { dir, minBytes, requireEnrichOk? }
// minBytes thresholds picked from observed historical floors (see MEMORY 2026-05-05).
const TRENDS = {
  'hn-ai-trend':       { dir: 'memory/state/hn-ai-trend',       minBytes: 8000,  requireEnrichOk: true },
  'latent-space-trend': { dir: 'memory/state/latent-space-trend', minBytes: 30000 },
  'arxiv-trend':       { dir: 'memory/state/arxiv-trend',       minBytes: 30000 },
  'github-trend':      { dir: 'memory/state/github-trend',      minBytes: 40000 },
};

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
let failures = 0;
const report = [];

for (const [name, cfg] of Object.entries(TRENDS)) {
  const file = path.join(ROOT, cfg.dir, `${today}.json`);
  if (!fs.existsSync(file)) {
    failures++;
    report.push(`✗ ${name}: missing ${file}`);
    continue;
  }
  const st = fs.statSync(file);
  if (st.size < cfg.minBytes) {
    failures++;
    report.push(`✗ ${name}: size ${st.size}B < min ${cfg.minBytes}B (${file})`);
    continue;
  }
  if (cfg.requireEnrichOk) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const e = data.enrichment || {};
      const ok = e.ok ?? 0;
      const fail = e.fail ?? 0;
      if (ok === 0 || fail > 0) {
        failures++;
        report.push(`✗ ${name}: enrich ok=${ok} fail=${fail} (${file})`);
        continue;
      }
      report.push(`✓ ${name}: ${st.size}B, enrich ok=${ok}/${ok+fail}`);
    } catch (err) {
      failures++;
      report.push(`✗ ${name}: parse error ${err.message}`);
      continue;
    }
  } else {
    report.push(`✓ ${name}: ${st.size}B`);
  }
}

console.log(`# verify-daily-trends ${today}`);
for (const line of report) console.log(line);
console.log(`---\n${failures === 0 ? 'OK' : 'FAIL'}: ${failures} failures of ${Object.keys(TRENDS).length} trends`);
process.exit(failures === 0 ? 0 : 1);
