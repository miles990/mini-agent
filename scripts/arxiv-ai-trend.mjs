#!/usr/bin/env node
/**
 * arXiv AI Trend — baseline fetcher
 *
 * Pulls latest papers from AI-relevant arXiv categories via the public
 * Atom API, writes baseline JSON to memory/state/arxiv-trend/YYYY-MM-DD.json
 * with summary fields = "pending-llm-pass" so an enricher can fill in.
 *
 * Schema mirrors hn-ai-trend.mjs / reddit-ai-trend.mjs (verified 2026-04-27):
 *   { run_at, config, count, posts:[{
 *       id, title, url, author, points, comments, created_at,
 *       story_text, summary:{claim,evidence,novelty,so_what},
 *       status, source, subreddit
 *   }] }
 *
 * Cron: TBD — register after first manual verification.
 *
 * Usage:
 *   node scripts/arxiv-ai-trend.mjs                           # default cats, max=50
 *   node scripts/arxiv-ai-trend.mjs --cats=cs.AI,cs.LG,cs.CL
 *   node scripts/arxiv-ai-trend.mjs --max=30 --dry-run
 *   node scripts/arxiv-ai-trend.mjs --out=/tmp/test.json
 *
 * Why no points/comments: arXiv has no voting. We synthesize a rank-decay
 * score (60 → 10) so freshest papers visualize as larger nodes in graph.html
 * while still letting enricher / LLM pass override later if desired.
 *
 * arXiv etiquette: identify yourself + space requests >= 3s apart.
 *   https://info.arxiv.org/help/api/user-manual.html#api_terms_of_use
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
};

const catsArg = getArg('cats', 'cs.AI,cs.LG,cs.CL,cs.MA');
const cats = catsArg.split(',').map(s => s.trim()).filter(Boolean);
const max = parseInt(getArg('max', '50'), 10);
const sortBy = getArg('sortBy', 'submittedDate'); // submittedDate|lastUpdatedDate|relevance
const outFlag = getArg('out', null);
const dryRun = args.includes('--dry-run');

const USER_AGENT = 'mini-agent-trend-reader/0.1 (+https://github.com/kuro-agent/mini-agent; contact: kuro.ai.agent@gmail.com)';

async function fetchText(url, attempt = 1) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } catch (e) {
    if (attempt < 3) {
      // arXiv etiquette: backoff at least 3s on retry
      await new Promise(res => setTimeout(res, 3000 * attempt));
      return fetchText(url, attempt + 1);
    }
    throw new Error(`${e.message} (${url})`);
  }
}

// --- Light Atom XML parsing (avoids extra deps) ---
// arXiv Atom entries have stable, simple structure. We only extract what
// schema needs. If arXiv changes format, fail loud rather than silent.

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function pickTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? decodeEntities(m[1].trim().replace(/\s+/g, ' ')) : '';
}

function pickAllTag(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g');
  const out = [];
  let m;
  while ((m = re.exec(xml)) !== null) out.push(decodeEntities(m[1].trim().replace(/\s+/g, ' ')));
  return out;
}

function parseEntries(atomXml) {
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  const out = [];
  let m;
  while ((m = entryRe.exec(atomXml)) !== null) out.push(m[1]);
  return out;
}

function parseEntry(entryXml) {
  // <id>http://arxiv.org/abs/2604.20987v1</id>
  const idUrl = pickTag(entryXml, 'id');
  const arxivIdMatch = idUrl.match(/abs\/([^v\s]+)(?:v\d+)?/);
  const arxivId = arxivIdMatch ? arxivIdMatch[1] : idUrl.split('/').pop();
  const title = pickTag(entryXml, 'title');
  const summary = pickTag(entryXml, 'summary');
  const published = pickTag(entryXml, 'published');
  const updated = pickTag(entryXml, 'updated');
  const authors = pickAllTag(entryXml, 'name');
  // primary_category: <arxiv:primary_category term="cs.AI" .../>
  const primCatMatch = entryXml.match(/<arxiv:primary_category[^>]*term="([^"]+)"/);
  const primaryCategory = primCatMatch ? primCatMatch[1] : null;
  return { arxivId, idUrl, title, summary, published, updated, authors, primaryCategory };
}

async function fetchCategory(catList) {
  // Combined query — single request hits all cats at once (more efficient + arXiv-friendly)
  const searchQuery = catList.map(c => `cat:${c}`).join('+OR+');
  const url = `http://export.arxiv.org/api/query?search_query=${searchQuery}&sortBy=${sortBy}&sortOrder=descending&max_results=${max}`;
  console.error(`[arxiv-ai-trend] fetch ${url}`);
  const xml = await fetchText(url);
  const entries = parseEntries(xml);
  if (entries.length === 0) {
    // sanity check: empty result should be loud — could be format change or rate-limit silent fail
    console.error(`[arxiv-ai-trend] WARN: 0 entries parsed. Raw length=${xml.length}. First 300 chars: ${xml.slice(0, 300)}`);
  }
  return entries.map(parseEntry);
}

function authorString(authors) {
  if (!authors || authors.length === 0) return '';
  if (authors.length === 1) return authors[0];
  if (authors.length <= 3) return authors.join(', ');
  return `${authors[0]} et al. (+${authors.length - 1})`;
}

async function main() {
  console.error(`[arxiv-ai-trend] cats=[${cats.join(',')}] sortBy=${sortBy} max=${max}`);
  const raw = await fetchCategory(cats);
  console.error(`[arxiv-ai-trend] parsed ${raw.length} entries`);

  // Map to common schema. Synthesize points = 60 → 10 by rank for visualization.
  const posts = raw.map((e, i) => {
    const synth = Math.max(10, 60 - i);
    return {
      id: `arxiv_${e.arxivId}`,
      title: e.title,
      url: e.idUrl, // arxiv abs URL
      author: authorString(e.authors),
      points: synth,
      comments: 0,
      created_at: e.published || e.updated || new Date().toISOString(),
      story_text: e.summary || null, // abstract goes here; enricher may LLM-summarize into summary.*
      summary: {
        claim: 'pending-llm-pass',
        evidence: 'pending-llm-pass',
        novelty: 'pending-llm-pass',
        so_what: 'pending-llm-pass',
      },
      status: 'baseline',
      source: 'arxiv',
      subreddit: null,
      // arxiv-specific extras (graph.html ignores unknown fields, so it's safe additive)
      arxiv_primary_category: e.primaryCategory,
    };
  });

  const date = new Date().toISOString().slice(0, 10);
  const outDir = join(REPO_ROOT, 'memory', 'state', 'arxiv-trend');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outFile = outFlag || join(outDir, `${date}.json`);

  const doc = {
    run_at: new Date().toISOString(),
    config: { cats, sortBy, max, outFile: outFlag },
    count: posts.length,
    posts,
  };

  if (dryRun) {
    console.error(`[arxiv-ai-trend] DRY RUN — would write ${posts.length} entries → ${outFile}`);
    console.log(JSON.stringify(doc, null, 2));
    return;
  }

  writeFileSync(outFile, JSON.stringify(doc, null, 2));
  console.error(`[arxiv-ai-trend] wrote ${posts.length} entries → ${outFile}`);
}

main().catch(e => {
  console.error(`[arxiv-ai-trend] FATAL: ${e.message}`);
  process.exit(1);
});
