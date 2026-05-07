#!/usr/bin/env node
/**
 * Deterministic fallback enricher for AI trend source state.
 *
 * Remote LLM enrichment is better, but closure cannot depend on it always
 * returning. This script fills pending summary fields with conservative
 * Traditional Chinese summaries derived from existing title/url metadata.
 *
 * Per-post differentiation: novelty + so_what now derive from category
 * detection (keyword rules over name+description) and engagement heat,
 * so 60 posts no longer share identical strings.
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

const STALE_FALLBACK_STRINGS = new Set([
  '以趨勢熱度納入觀察，需後續遠端摘要補強細節。',
  '可作為 agent 產品、工具鏈或基礎設施選型的候選訊號。',
]);

function isPending(value) {
  if (!value) return true;
  if (value === 'pending-llm-pass') return true;
  if (STALE_FALLBACK_STRINGS.has(String(value).trim())) return true;
  return false;
}

const CATEGORY_RULES = [
  { keys: ['agent', 'autogpt', 'autonomous', 'crewai', 'multi-agent', 'autogen'], label: 'Agent 框架/應用',
    so_what: '可比對自家 agent 架構的能力邊界與整合策略。' },
  { keys: ['mcp', 'tool-call', 'function-call', 'tool use', 'tool_use'], label: 'MCP / 工具呼叫',
    so_what: '評估納入工具鏈或暴露為 MCP server 的可行性。' },
  { keys: ['rag', 'retrieval', 'vector', 'embedding', 'memory', 'knowledge graph', 'kg'], label: 'RAG / 記憶層',
    so_what: '對照當前 KG/memory 設計，挑可借用的索引或 retrieval 模式。' },
  { keys: ['llm', 'gpt', 'claude', 'gemini', 'qwen', 'deepseek', 'llama', 'model'], label: '模型 / 推理',
    so_what: '追蹤可替換或補位的推理引擎，影響成本/延遲決策。' },
  { keys: ['code', 'codegen', 'developer', 'devtool', 'ide', 'cli', 'copilot'], label: '開發者工具',
    so_what: '評估納入工程工作流或學習其 UX 細節。' },
  { keys: ['ui', 'frontend', 'dashboard', 'app', 'web', 'studio', 'desktop'], label: '產品 / UI',
    so_what: '參考介面與互動設計，對照自家 dashboard 的呈現策略。' },
  { keys: ['data', 'dataset', 'benchmark', 'eval'], label: '資料 / 評測',
    so_what: '可作為比較或回歸測試的資料/評測來源。' },
  { keys: ['training', 'finetune', 'sft', 'rlhf', ' rl ', 'rl-'], label: '訓練 / 後訓練',
    so_what: '評估是否值得投入自訓或微調流程。' },
  { keys: ['workflow', 'pipeline', 'orchestrat', 'automat', 'n8n', 'flow', 'graph'], label: '工作流 / 編排',
    so_what: '對照當前 middleware 編排策略，找替代或補強位置。' },
  { keys: ['voice', 'tts', 'asr', 'speech', 'audio', 'video', 'image', 'vision', 'multimodal'], label: '多模態',
    so_what: '評估補上多模態能力的可行性與整合成本。' },
  { keys: ['security', 'sandbox', 'guard', 'safety', 'red-team', 'jailbreak'], label: '安全 / 沙箱',
    so_what: '檢視 agent 執行邊界與權限模型是否該升級。' },
  { keys: ['browser', 'scrap', 'crawl', 'puppeteer', 'playwright'], label: '瀏覽器 / 抓取',
    so_what: '對照現有 CDP 流程，評估替代抓取/操作介面。' },
];
const DEFAULT_CATEGORY = { label: '一般 AI 工具',
  so_what: '初步觀察，待後續判讀是否進入工具鏈或選型清單。' };

function detectCategory(name, desc) {
  const blob = ` ${name || ''} ${desc || ''} `.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keys.some(k => blob.includes(k))) return rule;
  }
  return DEFAULT_CATEGORY;
}

function describeHeat(points, comments) {
  if (points >= 1000) return `高熱度 (${points}★/${comments}留言)`;
  if (points >= 200) return `中等熱度 (${points}★/${comments}留言)`;
  if (points > 0) return `初現熱度 (${points}★/${comments}留言)`;
  return `熱度資料尚未累計 (${comments}留言)`;
}

const STOPWORDS = new Set(['the','a','an','for','and','of','to','in','on','with','by','from','is','are','be','this','that','its','your','our','their','he','she','it','we','as','at','or','but','not','no','so','if','use','using','built','build','make','very','more','most','can','you','i']);
function extractKeywords(text, n) {
  const seen = new Set();
  const out = [];

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
doc.fallback_enrichment = { changed, source, date, strategy: 'category-heat-keyword-summary-v2' };
writeFileSync(file, JSON.stringify(doc, null, 2));
console.log(`[fallback-enrich] source=${source} changed=${changed} file=${file}`);

function summarize(post, label) {
  const title = String(post.title || '未命名項目').trim();
  const { name, description } = splitRepoTitle(title);
  const subject = name || title.slice(0, 80);
  const desc = description || String(post.story_text || '').trim() || title;
  const points = Number(post.points ?? 0);
  const comments = Number(post.comments ?? 0);
  const category = detectCategory(name, desc);
  const heat = describeHeat(points, comments);
  const keywords = extractKeywords(desc, 3);
  const keywordPhrase = keywords.length ? keywords.join('、') : trimSentence(desc, 24);
  return {
    claim: `${label} ${subject} 聚焦 ${trimSentence(desc, 48)}`,
    evidence: `來源為 ${post.url || '本地趨勢資料'}；熱度 ${points} 點、${comments} 則討論。`,
    novelty: `${heat}，主題涵蓋 ${keywordPhrase}，屬於${category.label}類訊號。`,
    so_what: category.so_what,
  };
}


  const words = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff\s\-_.]/g, ' ')
    .split(/\s+/);
  for (const w of words) {
    if (w.length < 3) continue;
    if (STOPWORDS.has(w)) continue;
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= n) break;
  }
  return out;
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



function todayTaipei() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
