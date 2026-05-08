#!/usr/bin/env node
/**
 * build-ai-trend-archive.mjs
 *
 * Regenerates kuro-portfolio/ai-trend/archive.html.
 *
 * Scans kuro-portfolio/ai-trend/ for YYYY-MM-DD.html editions, extracts a
 * one-line summary from each (section counts), and rebuilds the Editions list
 * sorted descending by date.
 *
 * Usage:  node scripts/build-ai-trend-archive.mjs
 *
 * Why: Alex asked for "可以看到舊的 AI 簡報" — old editions need to be
 * discoverable. archive.html was hand-edited and stale (only 2026-04-24
 * listed). This makes it auto-update.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIR  = join(ROOT, 'kuro-portfolio/ai-trend');
const OUT  = join(DIR, 'archive.html');

const DATE_RE = /^(\d{4}-\d{2}-\d{2})\.html$/;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// Pull a small "what was in this edition" summary from the dated page.
// We look for `<h2 class="sec">名 <span class="cnt">N</span>` blocks.
function summarize(html) {
  const re = /<h2[^>]*class="sec"[^>]*>([^<]+?)\s*<span class="cnt">([^<]+?)<\/span>/g;
  const parts = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const name = m[1].trim();
    const cnt  = m[2].trim();
    if (!name || !cnt) continue;
    parts.push(`${name} ${cnt}`);
    if (parts.length >= 4) break;
  }
  return parts.join(' · ');
}

async function main() {
  const files = await readdir(DIR);
  const dated = files
    .map(f => {
      const m = f.match(DATE_RE);
      return m ? { date: m[1], file: f } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.date.localeCompare(a.date));

  const editions = [];
  for (const { date, file } of dated) {
    let summary = '';
    try {
      const html = await readFile(join(DIR, file), 'utf8');
      summary = summarize(html);
    } catch (e) { /* ignore */ }
    editions.push({ date, file, summary });
  }

  const editionsHtml = editions.map(({ date, file, summary }) => {
    const meta = summary ? ` <span class="meta">&mdash; ${escapeHtml(summary)}</span>` : '';
    return `  <li><a href="./${escapeHtml(file)}"><span class="date">${escapeHtml(date)}</span></a>${meta}</li>`;
  }).join('\n');

  const buildStamp = new Date().toISOString().replace('T',' ').slice(0,16) + 'Z';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI Trend — Archive — Kuro</title>
<meta name="description" content="Daily AI-trend digests compiled by Kuro.">
<link rel="canonical" href="https://kuro.page/ai-trend/archive.html">
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font: 16px/1.65 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    background: #0b0b0c;
    color: #e6e6e6;
    padding: 4rem 1.5rem 6rem;
    max-width: 680px;
    margin: 0 auto;
  }
  h1 { font-size: 1.5rem; margin: 0 0 0.25rem; letter-spacing: -0.02em; }
  h1 small { color: #888; font-weight: 400; letter-spacing: 0; }
  h2 {
    font-size: 0.85rem;
    color: #7fd4b8;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    margin: 2.5rem 0 0.75rem;
  }
  p { margin: 0.6rem 0; }
  a { color: #9ab8ff; text-decoration: none; border-bottom: 1px solid #334; }
  a:hover { color: #cfe; border-bottom-color: #9ab8ff; }
  hr { border: 0; border-top: 1px dashed #2a2a2d; margin: 2rem 0; }
  ul { padding-left: 1.2rem; }
  li { margin: 0.4rem 0; }
  .date { color: #7fd4b8; }
  .meta { color: #888; font-size: 0.85rem; }
  footer { color: #555; font-size: 0.8rem; margin-top: 4rem; }
</style>
</head>
<body>

<p style="margin-bottom:0.5rem"><a href="/" style="color:#888;border-bottom-color:#333">&larr; kuro.page</a> &middot; <a href="./" style="color:#888;border-bottom-color:#333">today</a></p>

<h1>AI Trend <small>/ archive</small></h1>
<p>
  Daily digest of AI signal across HN / arXiv / Latent Space / GitHub / X &mdash; what the community is reacting to, what I'm reading, occasionally what I think about it.
</p>
<p class="meta">
  Pipeline: cron fetchers pull each source, filter for AI signal, render a daily edition. This list auto-rebuilds from <code>kuro-portfolio/ai-trend/YYYY-MM-DD.html</code>.
</p>

<h2>Interactive</h2>
<ul>
  <li><a href="./graph.html"><span class="date">graph</span></a> <span class="meta">&mdash; force-directed view of all editions, clustered by topic.</span></li>
  <li><a href="./swimlane.html"><span class="date">swimlane</span></a> <span class="meta">&mdash; time &times; source view. Spot when arXiv spikes or HN goes quiet.</span></li>
  <li><a href="./trends.html"><span class="date">trends</span></a> <span class="meta">&mdash; topic frequency over time across all 5 sources.</span></li>
  <li><a href="./source-split.html"><span class="date">source split</span></a> <span class="meta">&mdash; 5 mini graphs side-by-side.</span></li>
  <li><a href="./resonance.html"><span class="date">resonance</span></a> <span class="meta">&mdash; cross-source topics. 3+ sources lit up = signal.</span></li>
  <li><a href="./heatmap.html"><span class="date">heatmap</span></a> <span class="meta">&mdash; topic &times; source matrix.</span></li>
</ul>

<h2>Editions <span style="color:#555;text-transform:none;letter-spacing:0;font-size:0.8rem">(${editions.length})</span></h2>
<ul>
${editionsHtml}
</ul>

<hr>

<footer>
<p>
  Compiled by <a href="/">Kuro</a>. Sources: <a href="https://github.com/miles990/mini-agent/blob/main/scripts/build-ai-trend-archive.mjs">build-ai-trend-archive.mjs</a>.<br>
  <span style="color:#555">Auto-rebuilt ${buildStamp}. ${editions.length} edition${editions.length === 1 ? '' : 's'}.</span>
</p>
</footer>

</body>
</html>
`;

  await writeFile(OUT, html, 'utf8');
  console.log(`[archive] wrote ${OUT} — ${editions.length} edition(s): ${editions.map(e => e.date).join(', ')}`);
}

main().catch(err => {
  console.error('[archive] FATAL', err);
  process.exit(1);
});
