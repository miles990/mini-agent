#!/usr/bin/env node
/**
 * build-kuro-content.mjs — daily kuro-content generator (issue #394 v0)
 *
 * Reads today's signal feeds + 3-day history slice + 1-shot exemplar,
 * calls Claude Sonnet via `claude` CLI, validates output against a gate,
 * and writes either memory/state/kuro-content/<DATE>.md (live) or
 * memory/state/kuro-content/<DATE>.md.draft (gate failed).
 *
 * Usage:
 *   node scripts/build-kuro-content.mjs            # default: today
 *   node scripts/build-kuro-content.mjs 2026-05-09 # explicit date
 *   FORCE_OVERWRITE=1 node scripts/build-kuro-content.mjs
 *
 * Exit codes:
 *   0 = wrote live file (gate passed)
 *   1 = wrote .draft file (gate failed) — caller should NOT promote
 *   2 = hard error (no claude CLI, no input data, write failure)
 *
 * Cron wiring (planned, follow-up commit): launchd 16:25 daily
 *   between enrich (~15:30) and build-ai-trend-index (16:30).
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// ---------- date arg ----------
const date = process.argv[2] || new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error(`[build-kuro-content] invalid date: ${date}`);
  process.exit(2);
}

const STATE = join(REPO_ROOT, 'memory', 'state');
const OUT_DIR = join(STATE, 'kuro-content');
const OUT_LIVE = join(OUT_DIR, `${date}.md`);
const OUT_DRAFT = `${OUT_LIVE}.draft`;
mkdirSync(OUT_DIR, { recursive: true });

if (existsSync(OUT_LIVE) && !process.env.FORCE_OVERWRITE) {
  console.error(`[build-kuro-content] ${OUT_LIVE} already exists; set FORCE_OVERWRITE=1 to replace`);
  process.exit(0);
}

// ---------- input gathering ----------
function dayBefore(d, n) {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() - n);
  return t.toISOString().slice(0, 10);
}

function loadJsonIfExists(path) {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, 'utf-8')); }
  catch (e) { console.error(`[build-kuro-content] parse fail ${path}: ${e.message}`); return null; }
}

function loadTextIfExists(path) {
  if (!existsSync(path)) return null;
  try { return readFileSync(path, 'utf-8'); } catch { return null; }
}

const FEEDS = [
  { name: 'hn',     dir: 'hn-ai-trend' },
  { name: 'arxiv',  dir: 'arxiv-trend' },
  { name: 'github', dir: 'github-trend' },
  { name: 'latent', dir: 'latent-space-trend' },
  { name: 'x',      dir: 'x-trend' },
];

function topItems(doc, n) {
  if (!doc) return [];
  const posts = doc.posts || doc.repos || doc.entries || [];
  return posts.slice(0, n).map(p => ({
    title: p.title || p.name || p.full_name || p.id,
    url: p.url || p.html_url || p.link,
    summary: p.summary?.claim || p.summary?.so_what || p.description || '',
    points: p.points,
    comments: p.comments,
  })).filter(x => x.title && x.url);
}

const today = {};
const history = {};
for (const feed of FEEDS) {
  const todayDoc = loadJsonIfExists(join(STATE, feed.dir, `${date}.json`));
  today[feed.name] = topItems(todayDoc, 12);
  history[feed.name] = [];
  for (let i = 1; i <= 3; i++) {
    const prev = loadJsonIfExists(join(STATE, feed.dir, `${dayBefore(date, i)}.json`));
    history[feed.name].push({ date: dayBefore(date, i), items: topItems(prev, 6) });
  }
}

const dailyPick = loadTextIfExists(join(STATE, 'kuro-daily-pick', `${date}.md`));

// ---------- exemplar (1-shot voice anchor) ----------
const EXEMPLAR_PATH = join(OUT_DIR, '2026-05-08.md');
const exemplar = loadTextIfExists(EXEMPLAR_PATH);
if (!exemplar) {
  console.error(`[build-kuro-content] FATAL: exemplar ${EXEMPLAR_PATH} missing — cannot anchor voice`);
  process.exit(2);
}

const template = loadTextIfExists(join(REPO_ROOT, 'scripts', 'ai-trend-content-template.md'));

// ---------- prompt ----------
const SYSTEM = `You are Kuro — Alex's autonomous AI agent. Your task: write today's daily AI-trend editorial as Kuro, in Kuro's voice.

VOICE ANCHOR: Match the exemplar exactly — Traditional Chinese as primary, mix in English for technical terms (model names, repo names, benchmarks), first-person ("我"), opinionated, observation-density over hype. Inline citations as [text](url). Connect today's signals to your own ongoing work where relevant.

OUTPUT FORMAT (markdown, no code fences around the whole doc):

---
date: ${date}
author: kuro
schema_version: 1
---

## kuro-take
<1-3 paragraphs. Each starts with a bolded headline ① ② ③. Inline [text](url) citations REQUIRED — at least 1 per paragraph. Synthesize across feeds; do not list items.>

## trend-arrows
### ↑ 上升中
- **<trend>** (rise · 強/中/弱)：<one-line evidence with [link](url)>
- ... (5 total)

### ↓ 下降中
- **<trend>** (fall · 強/中/弱)：<one-line evidence with [link](url)>
- ... (5 total)

## github-spotlight
**[\`owner/repo\`](https://github.com/owner/repo)** — <one-sentence why-it-matters in 繁中>

**選它的原因**：<2-3 sentences>
**一句話**：<technical pitch>
**License**：<MIT/Apache-2.0/etc>。**版本**：<semver if known>。**Stars**：<count if known>。

## swot
| | 強項 | 弱項 |
|---|---|---|
| **內部** | <strengths in 繁中> | <weaknesses in 繁中> |
| **外部** | <opportunities in 繁中> | <threats in 繁中> |

CONSTRAINTS:
- 600–2000 words total
- ≥3 inline [text](url) citations in kuro-take
- github-spotlight repo MUST exist and be reachable
- All four SWOT cells non-empty
- Do NOT use placeholder text like "<...>" in the actual output`;

const USER = `Today is ${date}.

=== TODAY'S SIGNALS ===
${FEEDS.map(f => `\n--- ${f.name} (top ${today[f.name].length}) ---\n${today[f.name].map(it => `- [${it.title}](${it.url})${it.summary ? ` — ${it.summary}` : ''}`).join('\n')}`).join('\n')}

=== 3-DAY HISTORY (for trend deltas) ===
${FEEDS.map(f => `\n--- ${f.name} history ---\n${history[f.name].map(h => `[${h.date}] ${h.items.map(it => it.title).join(' / ')}`).join('\n')}`).join('\n')}

${dailyPick ? `=== TODAY'S KURO-DAILY-PICK (curated highlights) ===\n${dailyPick}\n` : ''}

=== VOICE EXEMPLAR (match this voice exactly) ===
${exemplar}

${template ? `=== TEMPLATE STRUCTURE ===\n${template}\n` : ''}

Now write today's (${date}) kuro-content following the OUTPUT FORMAT above. Synthesize across feeds. Be opinionated. Connect to your ongoing work. Output ONLY the markdown document, starting with the frontmatter \`---\`.`;

// ---------- claude CLI call ----------
console.error(`[build-kuro-content] date=${date} feeds-loaded=${FEEDS.filter(f => today[f.name].length > 0).length}/${FEEDS.length} prompt-bytes=${(SYSTEM.length + USER.length)}`);

const fullPrompt = `${SYSTEM}\n\n${USER}`;
let raw;
try {
  raw = execSync(
    `claude -p --model sonnet --output-format text`,
    {
      input: fullPrompt,
      timeout: 180_000,
      encoding: 'utf-8',
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  );
} catch (e) {
  const stderr = (e.stderr?.toString?.() || '').trim();
  console.error(`[build-kuro-content] claude CLI fail status=${e.status} signal=${e.signal}: ${stderr.slice(0, 600)}`);
  process.exit(2);
}

const body = raw.trim();
if (!body) {
  console.error(`[build-kuro-content] empty output from claude CLI`);
  process.exit(2);
}

// ---------- validation gate ----------
const checks = [];

// gate 1: frontmatter present
const hasFrontmatter = /^---\s*\n[\s\S]*?\n---\s*\n/.test(body);
checks.push({ name: 'frontmatter', ok: hasFrontmatter });

// gate 2: required sections
const requiredSections = ['## kuro-take', '## github-spotlight', '## swot'];
for (const s of requiredSections) {
  checks.push({ name: `section ${s}`, ok: body.includes(s) });
}

// gate 3: ≥3 inline links in kuro-take section
const takeMatch = body.match(/## kuro-take\n([\s\S]*?)(?=\n## |$)/);
const takeBody = takeMatch ? takeMatch[1] : '';
const linkCount = (takeBody.match(/\[[^\]]+\]\([^)]+\)/g) || []).length;
checks.push({ name: '≥3 links in kuro-take', ok: linkCount >= 3, detail: `found ${linkCount}` });

// gate 4: github-spotlight has owner/repo
const spotlightMatch = body.match(/## github-spotlight\n([\s\S]*?)(?=\n## |$)/);
const spotlightBody = spotlightMatch ? spotlightMatch[1] : '';
const repoMatch = spotlightBody.match(/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+/);
checks.push({ name: 'github-spotlight repo', ok: !!repoMatch, detail: repoMatch?.[0] });

// gate 5: SWOT non-empty (4 dims = look for 4 non-empty table cells in swot section)
const swotMatch = body.match(/## swot\n([\s\S]*?)(?=\n## |$)/);
const swotBody = swotMatch ? swotMatch[1] : '';
const swotCellsNonEmpty = (swotBody.match(/\|[^|\n]{4,}/g) || []).length >= 6; // header + 4 dims approx
checks.push({ name: 'SWOT non-empty', ok: swotCellsNonEmpty });

// gate 6: word count 600–2000 (rough — count whitespace tokens)
const wordCount = body.split(/\s+/).filter(Boolean).length;
const wordsOk = wordCount >= 600 && wordCount <= 2500; // give some headroom
checks.push({ name: 'word count', ok: wordsOk, detail: `${wordCount} words` });

const allOk = checks.every(c => c.ok);
console.error(`[build-kuro-content] gate results:`);
for (const c of checks) {
  console.error(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
}

// ---------- write ----------
if (allOk) {
  writeFileSync(OUT_LIVE, body);
  console.error(`[build-kuro-content] OK — wrote ${OUT_LIVE} (${wordCount} words, ${linkCount} links in take)`);
  process.exit(0);
} else {
  writeFileSync(OUT_DRAFT, body);
  console.error(`[build-kuro-content] GATE FAILED — wrote ${OUT_DRAFT} (live page stays on placeholder)`);
  process.exit(1);
}
