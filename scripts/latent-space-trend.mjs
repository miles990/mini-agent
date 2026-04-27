#!/usr/bin/env node
/**
 * Latent Space AI Trend — baseline fetcher
 *
 * Pulls recent posts from Latent Space (latent.space) RSS feed,
 * writes baseline JSON to memory/state/latent-space-trend/YYYY-MM-DD.json
 * with summary fields = "pending-llm-pass" so an enricher can fill in.
 *
 * Schema mirrors hn-ai-trend.mjs / reddit-ai-trend.mjs / arxiv-ai-trend.mjs:
 *   { run_at, config, count, posts:[{
 *       id, title, url, author, points, comments, created_at,
 *       story_text, summary:{claim,evidence,novelty,so_what},
 *       status, source, subreddit
 *   }] }
 *
 * Cron: TBD — register after first manual verification.
 *
 * Usage:
 *   node scripts/latent-space-trend.mjs                       # default max=30
 *   node scripts/latent-space-trend.mjs --max=20 --dry-run
 *   node scripts/latent-space-trend.mjs --out=/tmp/test.json
 *
 * Why no points/comments: RSS feeds don't expose voting / comment counts.
 * We synthesize a rank-decay score (60 → 10) so freshest posts visualize as
 * larger nodes in graph.html, mirroring arxiv-ai-trend.mjs convention.
 *
 * Etiquette: identify ourselves via User-Agent, throttle retries.
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

const FEED_URL = getArg('feed', 'https://www.latent.space/feed');
const max = parseInt(getArg('max', '30'), 10);
const outFlag = getArg('out', null);
const dryRun = args.includes('--dry-run');

const USER_AGENT = 'mini-agent-trend-reader/0.1 (+https://github.com/kuro-agent/mini-agent; contact: kuro.ai.agent@gmail.com)';

async function fetchText(url, attempt = 1) {
  try {
    const r = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/rss+xml, application/xml, text/xml, */*' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } catch (e) {
    if (attempt < 3) {
      await new Promise(res => setTimeout(res, 2000 * attempt));
      return fetchText(url, attempt + 1);
    }
    throw new Error(`${e.message} (${url})`);
  }
}

// --- Light RSS 2.0 / Atom parsing (avoids extra deps) ---

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function pickTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`));
  return m ? decodeEntities(m[1].trim().replace(/\s+/g, ' ')) : '';
}

function parseItems(xml) {
  // RSS 2.0 uses <item>, Atom uses <entry>. Try both.
  const itemRe = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/g;
  const entryRe = /<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/g;
  const out = [];
  let m;
  while ((m = itemRe.exec(xml)) !== null) out.push({ kind: 'rss', body: m[1] });
  if (out.length === 0) {
    while ((m = entryRe.exec(xml)) !== null) out.push({ kind: 'atom', body: m[1] });
  }
  return out;
}

function parseItem({ kind, body }) {
  if (kind === 'rss') {
    const title = pickTag(body, 'title');
    const link = pickTag(body, 'link');
    const pubDate = pickTag(body, 'pubDate');
    const guid = pickTag(body, 'guid') || link;
    // Substack feeds use <dc:creator> for author; fall back to <author>
    const creator = pickTag(body, 'dc:creator') || pickTag(body, 'author');
    const description = pickTag(body, 'description');
    const contentEncoded = pickTag(body, 'content:encoded');
    const story = stripTags(contentEncoded || description).slice(0, 2000);
    return {
      id: guid,
      title,
      url: link,
      author: creator,
      published: pubDate ? new Date(pubDate).toISOString() : '',
      story,
    };
  }
  // atom
  const title = pickTag(body, 'title');
  const idUrl = pickTag(body, 'id');
  // <link href="..."/>
  const linkMatch = body.match(/<link[^>]+href="([^"]+)"/);
  const link = linkMatch ? linkMatch[1] : idUrl;
  const updated = pickTag(body, 'updated') || pickTag(body, 'published');
  const author = pickTag(body, 'name');
  const summary = pickTag(body, 'summary') || pickTag(body, 'content');
  return {
    id: idUrl || link,
    title,
    url: link,
    author,
    published: updated || '',
    story: stripTags(summary).slice(0, 2000),
  };
}

function slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
}

async function main() {
  console.error(`[latent-space-trend] fetch ${FEED_URL} max=${max}`);
  const xml = await fetchText(FEED_URL);
  const items = parseItems(xml).slice(0, max);
  if (items.length === 0) {
    console.error(`[latent-space-trend] WARN: 0 items parsed. Raw length=${xml.length}. First 300 chars: ${xml.slice(0, 300)}`);
  }

  const posts = items.map((raw, i) => {
    const e = parseItem(raw);
    const synth = Math.max(10, 60 - i);
    const id = `latent_${slugify(e.title) || `item_${i}`}`;
    return {
      id,
      title: e.title,
      url: e.url,
      author: e.author || 'Latent Space',
      points: synth,
      comments: 0,
      created_at: e.published || new Date().toISOString(),
      story_text: e.story || null,
      summary: {
        claim: 'pending-llm-pass',
        evidence: 'pending-llm-pass',
        novelty: 'pending-llm-pass',
        so_what: 'pending-llm-pass',
      },
      status: 'baseline',
      source: 'latent',
      subreddit: null,
    };
  });

  const date = new Date().toISOString().slice(0, 10);
  const outDir = join(REPO_ROOT, 'memory', 'state', 'latent-space-trend');
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  const outFile = outFlag || join(outDir, `${date}.json`);

  const doc = {
    run_at: new Date().toISOString(),
    config: { feed: FEED_URL, max, outFile: outFlag },
    count: posts.length,
    posts,
  };

  if (dryRun) {
    console.error(`[latent-space-trend] DRY RUN — would write ${posts.length} entries → ${outFile}`);
    console.log(JSON.stringify(doc, null, 2));
    return;
  }

  writeFileSync(outFile, JSON.stringify(doc, null, 2));
  console.error(`[latent-space-trend] wrote ${posts.length} entries → ${outFile}`);
}

main().catch(e => {
  console.error(`[latent-space-trend] FATAL: ${e.message}`);
  process.exit(1);
});
