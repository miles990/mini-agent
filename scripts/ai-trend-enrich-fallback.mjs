#!/usr/bin/env node
/**
 * Deterministic fallback enricher for AI trend source state.
 *
 * Remote LLM enrichment is better, but closure cannot depend on it always
 * returning. This script fills pending summary fields with conservative
 * Traditional Chinese summaries derived from existing title/url metadata.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const flag = (name) => (args.find(a => a.startsWith(`--${name}=`)) || '').split('=')[1];
const source = flag('source') || 'github';
const date = flag('date') || todayTaipei();

const SOURCE_MAP = {
  github: { dir: 'github-trend', label: 'GitHub 專案' },
  hn: { dir: 'hn-ai-trend', label: 'HN 討論' },
  arxiv: { dir: 'arxiv-trend', label: 'arXiv 論文' },
  latent: { dir: 'latent-space-trend', label: 'Latent Space 文章' },
  x: { dir: 'x-trend', label: 'X 討論' },
};

const cfg = SOURCE_MAP[source];
if (!cfg) {
  console.error(`[fallback-enrich] unknown source=${source}; valid=${Object.keys(SOURCE_MAP).join('|')}`);
  process.exit(2);
}

const file = join(REPO_ROOT, 'memory/state', cfg.dir, `${date}.json`);
const doc = JSON.parse(readFileSync(file, 'utf8'));
let changed = 0;

for (const post of doc.posts || []) {
  const summary = post.summary || {};
  if (!isPending(summary.claim) && !isPending(summary.so_what) && !isPending(summary.novelty) && !isPending(summary.evidence)) {
    continue;
  }
  const fallback = summarize(post, cfg.label);
  post.summary = {
    claim: isPending(summary.claim) ? fallback.claim : summary.claim,
    evidence: isPending(summary.evidence) ? fallback.evidence : summary.evidence,
    novelty: isPending(summary.novelty) ? fallback.novelty : summary.novelty,
    so_what: isPending(summary.so_what) ? fallback.so_what : summary.so_what,
  };
  post.status = post.status === 'dry-run' ? 'fallback-enriched' : (post.status || 'fallback-enriched');
  changed++;
}

doc.fallback_enriched_at = new Date().toISOString();
doc.fallback_enrichment = { changed, source, date, strategy: 'deterministic-title-url-summary' };
writeFileSync(file, JSON.stringify(doc, null, 2));
console.log(`[fallback-enrich] source=${source} changed=${changed} file=${file}`);

function summarize(post, label) {
  const title = String(post.title || '未命名項目').trim();
  const { name, description } = splitRepoTitle(title);
  const subject = name || title.slice(0, 80);
  const desc = description || String(post.story_text || '').trim() || title;
  const points = Number(post.points ?? 0);
  const comments = Number(post.comments ?? 0);
  return {
    claim: `${label} ${subject} 聚焦 ${trimSentence(desc, 48)}`,
    evidence: `來源為 ${post.url || '本地趨勢資料'}；熱度 ${points} 點、${comments} 則討論。`,
    novelty: `以趨勢熱度納入觀察，需後續遠端摘要補強細節。`,
    so_what: `可作為 agent 產品、工具鏈或基礎設施選型的候選訊號。`,
  };
}

function splitRepoTitle(title) {
  const match = title.match(/^([^:：]+)[:：]\s*(.+)$/);
  if (!match) return { name: '', description: title };
  return { name: match[1].trim(), description: match[2].trim() };
}

function trimSentence(value, max) {
  const compact = String(value || '').replace(/\s+/g, ' ').trim();
  return compact.length <= max ? compact : `${compact.slice(0, max - 1)}…`;
}

function isPending(value) {
  return !value || value === 'pending-llm-pass';
}

function todayTaipei() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
