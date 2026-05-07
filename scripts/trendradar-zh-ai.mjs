#!/usr/bin/env node
/**
 * TrendRadar zh-CN AI Lane — 6th-source-style fetcher (中文圈 AI 趨勢)
 *
 * Inspired by sansan0/TrendRadar (GPL-3.0) — we borrow their platform whitelist
 * (toutiao/baidu/weibo/zhihu/bilibili-hot-search/thepaper/wallstreetcn) but do
 * our own fetch + filter so we don't fork or carry their MCP/SQLite stack.
 *
 * Data source: DailyHotApi-compatible mirror (imsyy/DailyHotApi). Configurable
 * via --base= so we can swap mirrors when one goes down. Some public mirrors:
 *   - https://api-hot.efox.cc/api/s
 *   - https://dailyhot.tinyplay.cc/api/s
 *   - self-hosted (recommended for production)
 *
 * Usage:
 *   node scripts/trendradar-zh-ai.mjs                              # default: 7 platforms, AI keyword filter
 *   node scripts/trendradar-zh-ai.mjs --platforms=weibo,zhihu --max=20
 *   node scripts/trendradar-zh-ai.mjs --base=https://my-mirror/api/s
 *   node scripts/trendradar-zh-ai.mjs --dry-run --out=/tmp/test.json
 *
 * Schema (mirrors github-ai-trend.mjs):
 *   { run_at, config, count, posts:[{
 *       id, title, url, author, points, comments, created_at,
 *       story_text, summary:{claim,evidence,novelty,so_what},
 *       status, source:"trendradar-zh", platform, hot_value
 *   }] }
 *
 * AI keyword whitelist (zh + en, case-insensitive):
 *   AI、人工智能、大模型、大語言模型、LLM、agent、智能體、智能体、RAG、
 *   Kimi、DeepSeek、通義、通义、Qwen、智譜、智谱、文心、豆包、Claude、GPT、
 *   ChatGPT、Sora、Gemini、開源模型、开源模型、模型訓練、模型训练
 *
 * Why post-filter (not pre-filter): platform hot-lists are short (~50 items)
 * and we want full visibility into "what's hot vs what's hot AND AI-relevant".
 * The ratio itself is signal. Cost is negligible.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const a = args.find(x => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1] : def;
};

// Borrowed from TrendRadar config.yaml platforms list (sansan0/TrendRadar).
// These IDs are the de-facto standard from imsyy/DailyHotApi.
const DEFAULT_PLATFORMS = 'toutiao,weibo,zhihu,bilibili-hot-search,thepaper,wallstreetcn-hot,baidu';
const platformsArg = getArg('platforms', DEFAULT_PLATFORMS);
const platforms = platformsArg.split(',').map(s => s.trim()).filter(Boolean);

const baseArg = getArg('base', 'https://api-hot.efox.cc/api/s');
const max = parseInt(getArg('max', '50'), 10);
const outFlag = getArg('out', null);
const dryRun = args.includes('--dry-run');
const verbose = args.includes('--verbose');

// Whitelist — case-insensitive substring match against title.
const AI_KEYWORDS = [
  'AI', '人工智能', '大模型', '大語言模型', '大语言模型', 'LLM',
  'agent', 'agentic', '智能體', '智能体', 'RAG',
  'Kimi', 'DeepSeek', '通義', '通义', 'Qwen', '智譜', '智谱', '文心', '豆包',
  'Claude', 'GPT', 'ChatGPT', 'Sora', 'Gemini',
  '開源模型', '开源模型', '模型訓練', '模型训练',
  'OpenAI', 'Anthropic', '阿里通义', '騰訊混元', '腾讯混元'
];

const KW_RE = new RegExp(
  AI_KEYWORDS.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'),
  'i'
);

const USER_AGENT = 'mini-agent-trend-reader/0.1 (+https://github.com/kuro-agent/mini-agent)';

function isAiRelevant(title) {
  if (!title) return false;
  return KW_RE.test(title);
}

async function fetchPlatform(platformId) {
  const url = `${baseArg}?id=${encodeURIComponent(platformId)}`;
  if (verbose) console.error(`[fetch] ${url}`);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.error(`[skip] ${platformId}: HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    const items = data.data || data.items || [];
    return items.map((it, idx) => ({
      id: `${platformId}:${it.id || idx}`,
      title: it.title || '',
      url: it.url || it.mobileUrl || '',
      author: data.title || platformId,
      points: it.hot ?? null,
      comments: null,
      created_at: data.updateTime || new Date().toISOString(),
      story_text: it.desc || '',
      summary: { claim: '', evidence: '', novelty: 'pending-llm-pass', so_what: '' },
      status: 'fetched',
      source: 'trendradar-zh',
      platform: platformId,
      hot_value: it.hot ?? null,
    }));
  } catch (err) {
    console.error(`[error] ${platformId}: ${err.message}`);
    return [];
  }
}

async function main() {
  const run_at = new Date().toISOString();
  const config = { platforms, base: baseArg, max, ai_keywords: AI_KEYWORDS };

  if (dryRun) {
    const stub = {
      run_at, config, count: 0, posts: [],
      _note: 'dry-run: no network. Run without --dry-run to fetch.',
    };
    const out = outFlag || '/tmp/trendradar-zh-ai-dry.json';
    writeFileSync(out, JSON.stringify(stub, null, 2));
    console.log(`[dry] wrote ${out}`);
    return;
  }

  const allPosts = [];
  for (const p of platforms) {
    const posts = await fetchPlatform(p);
    const ai = posts.filter(x => isAiRelevant(x.title));
    if (verbose) console.error(`[${p}] ${posts.length} total → ${ai.length} AI`);
    allPosts.push(...ai);
  }

  // Sort by hot_value desc when available, then truncate.
  allPosts.sort((a, b) => (b.hot_value || 0) - (a.hot_value || 0));
  const final = allPosts.slice(0, max);

  const today = run_at.slice(0, 10);
  const outDir = join(REPO_ROOT, 'memory', 'state', 'trendradar-zh-ai');
  mkdirSync(outDir, { recursive: true });
  const outPath = outFlag || join(outDir, `${today}.json`);
  const payload = { run_at, config, count: final.length, posts: final };
  writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`[ok] ${final.length} AI items across ${platforms.length} platforms → ${outPath}`);
}

main().catch(err => { console.error(err); process.exit(1); });
