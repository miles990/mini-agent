#!/usr/bin/env node
/**
 * build-kuro-content.mjs — Kuro daily content generator (#394)
 *
 * Reads upstream feeder JSON/MD files (already produced by ai-trend pipeline),
 * calls Anthropic claude-sonnet API with a 1-shot exemplar to generate Kuro's
 * daily editorial content, validates the output, and writes
 * memory/state/kuro-content/<DATE>.md.
 *
 * If the validation gate fails, writes <DATE>.md.draft instead so the live
 * page stays on placeholder rather than shipping low-quality output.
 *
 * Schedule (launchd):
 *   16:25 daily — after enrich (~15:30), before build-ai-trend-index (16:30)
 *
 * Usage:
 *   node scripts/build-kuro-content.mjs               # today
 *   node scripts/build-kuro-content.mjs 2026-05-09    # specific date
 *   node scripts/build-kuro-content.mjs --dry-run     # no file writes
 *
 * Env:
 *   ANTHROPIC_API_KEY (required)
 *
 * Acceptance:
 *   1. Missing input files -> graceful warn, partial output still valid (no abort)
 *   2. Validation gate prevents low-quality output reaching live page
 *   3. Output matches schema consumed by loadKuroContent() in build-ai-trend-preview.mjs
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const STATE_DIR = join(REPO_ROOT, 'memory', 'state');

// -- CLI args -----------------------------------------------------------------
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flags = process.argv.slice(2).filter(a => a.startsWith('--'));
const dryRun = flags.includes('--dry-run');

function todayTaipei() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}
const DATE = args[0] || todayTaipei();

// -- Helpers ------------------------------------------------------------------
async function tryRead(filePath) {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

/** Load most-recent feeder JSON within lookback window, return { key, posts, run_at, daysOld } */
async function loadFeeder(subdir, fromDate, lookbackDays = 4) {
  const d = new Date(fromDate + 'T00:00:00Z');
  for (let i = 0; i < lookbackDays; i++) {
    const dd = new Date(d.getTime() - i * 86400_000);
    const key = dd.toISOString().slice(0, 10);
    const raw = await tryRead(join(STATE_DIR, subdir, `${key}.json`));
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        return { key, posts: parsed.posts || [], run_at: parsed.run_at, daysOld: i };
      } catch {
        // malformed -- try next day
      }
    }
  }
  return { key: null, posts: [], run_at: null, daysOld: null };
}

/** Load most-recent kuro-daily-pick MD */
async function loadDailyPick(fromDate, lookbackDays = 4) {
  const d = new Date(fromDate + 'T00:00:00Z');
  for (let i = 0; i < lookbackDays; i++) {
    const dd = new Date(d.getTime() - i * 86400_000);
    const key = dd.toISOString().slice(0, 10);
    const md = await tryRead(join(STATE_DIR, 'kuro-daily-pick', `${key}.md`));
    if (md) return { key, md, daysOld: i };
  }
  return { key: null, md: '', daysOld: null };
}

/** Load up to N days of a feeder (for delta context) */
async function loadHistory(subdir, fromDate, days) {
  const results = [];
  const d = new Date(fromDate + 'T00:00:00Z');
  for (let i = 1; i <= days; i++) {
    const dd = new Date(d.getTime() - i * 86400_000);
    const key = dd.toISOString().slice(0, 10);
    const raw = await tryRead(join(STATE_DIR, subdir, `${key}.json`));
    if (raw) {
      try { results.push({ key, ...(JSON.parse(raw)) }); } catch {}
    }
  }
  return results;
}

/** Summarise a feeder's posts into a compact text block for the prompt */
function summarisePosts(label, posts, maxItems = 8) {
  if (!posts || posts.length === 0) return null;
  const items = posts.slice(0, maxItems).map((p, i) => {
    const zh = p.summary?.claim && p.summary.claim !== 'pending-llm-pass'
      ? ` -- ${p.summary.claim}`
      : '';
    const pts = p.points != null ? ` (${p.points}pts)` : '';
    return `  ${i + 1}. [${p.title}](${p.url || ''})${pts}${zh}`;
  });
  return `### ${label}\n${items.join('\n')}`;
}

// -- Validation gate ----------------------------------------------------------
/** Returns list of validation failure strings (empty = pass) */
export function validate(content) {
  const issues = [];

  // Word count 600-2000
  const wordCount = content.split(/\s+/).filter(Boolean).length;
  if (wordCount < 600) issues.push(`word count too low: ${wordCount} (min 600)`);
  if (wordCount > 2000) issues.push(`word count too high: ${wordCount} (max 2000)`);

  // >=1 [text](url) link in kuro-take section
  const takeMatch = content.match(/## kuro-take([\s\S]*?)(?=\n## |\s*$)/);
  if (!takeMatch) {
    issues.push('missing ## kuro-take section');
  } else {
    const takeBody = takeMatch[1] || '';
    const links = takeBody.match(/\[[^\]]+\]\([^)\s]+\)/g) || [];
    if (links.length === 0) issues.push('kuro-take section has no [text](url) links');
  }

  // repo field matches owner/repo regex
  const repoMatch = content.match(/^repo:\s*(.+)$/m);
  if (!repoMatch) {
    issues.push('missing repo: field in github-spotlight section');
  } else {
    const repo = repoMatch[1].trim();
    if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repo)) {
      issues.push(`repo field does not match owner/repo format: "${repo}"`);
    }
  }

  // SWOT has all 4 dimensions non-empty
  const swotMatch = content.match(/## swot([\s\S]*?)(?=\n## |\s*$)/);
  if (!swotMatch) {
    issues.push('missing ## swot section');
  } else {
    const swotBody = swotMatch[1] || '';
    const dims = ['strengths', 'weaknesses', 'opportunities', 'threats'];
    for (const dim of dims) {
      const dimMatch = swotBody.match(new RegExp(`^${dim}:\\s*$`, 'm'));
      if (!dimMatch) {
        issues.push(`SWOT missing ${dim} dimension`);
      } else {
        // Check that at least one bullet follows before the next dimension header
        const dimIdx = swotBody.indexOf(dimMatch[0]);
        const afterDim = swotBody.slice(dimIdx + dimMatch[0].length);
        const nextDimIdx = afterDim.search(/^[a-zA-Z]+:\s*$/m);
        const segment = nextDimIdx >= 0 ? afterDim.slice(0, nextDimIdx) : afterDim;
        const bullet = segment.match(/^\s*-\s+.+/m);
        if (!bullet) issues.push(`SWOT ${dim} dimension has no bullet items`);
      }
    }
  }

  return issues;
}

// -- Anthropic call -----------------------------------------------------------
async function callAnthropic(systemPrompt, userPrompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set');
  }

  const body = JSON.stringify({
    model: 'claude-sonnet-4-5',
    max_tokens: 4096,
    messages: [
      { role: 'user', content: userPrompt },
    ],
    system: systemPrompt,
  });

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body,
    signal: AbortSignal.timeout(120_000),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Anthropic API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  const data = await response.json();
  const text = data?.content?.[0]?.text;
  if (!text) throw new Error('Empty response from Anthropic API');
  return text;
}

// -- Main ---------------------------------------------------------------------
async function main() {
  console.log(`[kuro-content] building ${DATE}${dryRun ? ' (dry-run)' : ''}`);

  // 1. Load upstream feeders (all graceful -- missing -> warn, continue)
  const hn = await loadFeeder('hn-ai-trend', DATE);
  const arxiv = await loadFeeder('arxiv-trend', DATE);
  const github = await loadFeeder('github-trend', DATE);
  const latent = await loadFeeder('latent-space-trend', DATE);
  const x = await loadFeeder('x-trend', DATE);
  const pick = await loadDailyPick(DATE);

  const feeders = [
    { label: 'HN AI', info: hn },
    { label: 'arXiv', info: arxiv },
    { label: 'GitHub', info: github },
    { label: 'Latent Space', info: latent },
    { label: 'X', info: x },
  ];

  let loadedCount = 0;
  for (const { label, info } of feeders) {
    if (info.key) {
      loadedCount++;
      const stale = info.daysOld && info.daysOld > 0 ? ` (${info.daysOld}d stale)` : '';
      console.log(`[kuro-content] ${label}: ${info.posts.length} posts from ${info.key}${stale}`);
    } else {
      console.warn(`[kuro-content] WARN: ${label} -- no data found in last 4 days`);
    }
  }
  if (pick.key) {
    console.log(`[kuro-content] kuro-daily-pick: ${pick.key}`);
  } else {
    console.warn(`[kuro-content] WARN: kuro-daily-pick -- no data found`);
  }

  if (loadedCount === 0) {
    console.error('[kuro-content] ERROR: zero feeders available; cannot generate meaningful content. Aborting.');
    process.exit(1);
  }

  // 2. Load 3-day history for delta context
  const hnHistory = await loadHistory('hn-ai-trend', DATE, 3);
  const githubHistory = await loadHistory('github-trend', DATE, 3);

  // 3. Load 1-shot exemplar
  const exemplarPath = join(STATE_DIR, 'kuro-content', '2026-05-08.md');
  const exemplar = await tryRead(exemplarPath);
  if (!exemplar) {
    console.warn('[kuro-content] WARN: 1-shot exemplar 2026-05-08.md not found; continuing without it');
  }

  // 4. Build system + user prompts
  const systemPrompt = [
    "You are Kuro, a personal AI agent with deep expertise in AI/ML trends.",
    "Write in Kuro's voice: analytical, opinionated, concise, using Traditional Chinese (繁體中文).",
    "Technical terms (model names, APIs, repo names, benchmarks) stay in English.",
    "Match the voice, structure, and quality of the provided exemplar.",
    "",
    "OUTPUT FORMAT (strict -- no prose outside these sections):",
    "---",
    "date: YYYY-MM-DD",
    "author: kuro",
    "schema_version: 1",
    "generated: true",
    "---",
    "",
    "## kuro-take",
    "(1-3 paragraphs, each paragraph separated by blank line, inline [text](url) citations required)",
    "",
    "## github-spotlight",
    "repo: owner/repo",
    "license: <license>",
    "version: <version>",
    "why-it-matters: <one paragraph>",
    "why-good:",
    "- <reason 1>",
    "- <reason 2>",
    "risk:",
    "- <risk>",
    "",
    "## swot",
    "strengths:",
    "- <bullet>",
    "weaknesses:",
    "- <bullet>",
    "opportunities:",
    "- <bullet>",
    "threats:",
    "- <bullet>",
  ].join('\n');

  const signalBlocks = feeders
    .map(({ label, info }) => summarisePosts(label, info.posts))
    .filter(Boolean);

  const historyBlock = [
    hnHistory.length > 0
      ? `### HN 近 3 日 top topics\n${hnHistory.flatMap(h => (h.posts || []).slice(0, 3).map(p => `  - [${p.title}](${p.url})`)).join('\n')}`
      : null,
    githubHistory.length > 0
      ? `### GitHub 近 3 日 top repos\n${githubHistory.flatMap(h => (h.posts || []).slice(0, 3).map(p => `  - [${p.title}](${p.url})`)).join('\n')}`
      : null,
  ].filter(Boolean).join('\n\n');

  const exemplarBlock = exemplar
    ? `\n\n--- EXEMPLAR (2026-05-08.md -- match this voice and quality) ---\n${exemplar.slice(0, 3000)}\n--- END EXEMPLAR ---`
    : '';

  const userPrompt = [
    `Generate Kuro's daily AI trend editorial for ${DATE}.`,
    '',
    "## Today's signal data",
    '',
    signalBlocks.join('\n\n'),
    '',
    pick.md ? `### Kuro Daily Pick (${pick.key})\n${pick.md.slice(0, 1000)}` : '',
    '',
    historyBlock ? `## 3-day history (for delta context)\n${historyBlock}` : '',
    exemplarBlock,
    '',
    'Write the full output now. Follow the OUTPUT FORMAT exactly.',
  ].filter(s => s !== '').join('\n');

  // 5. Call Anthropic
  console.log('[kuro-content] calling Anthropic claude-sonnet-4-5...');
  let generated;
  try {
    generated = await callAnthropic(systemPrompt, userPrompt);
  } catch (err) {
    console.error(`[kuro-content] ERROR: Anthropic API call failed: ${err.message}`);
    process.exit(1);
  }

  // Strip any accidental code fences the model might wrap around output
  generated = generated.replace(/^```(?:markdown)?\n?/m, '').replace(/\n?```\s*$/m, '').trim();

  // Ensure the frontmatter date is correct (model might copy exemplar's date)
  generated = generated.replace(/^date:\s*.+$/m, `date: ${DATE}`);

  console.log(`[kuro-content] generated ${generated.split(/\s+/).length} words`);

  // 6. Validation gate
  const validationErrors = validate(generated);
  const outDir = join(STATE_DIR, 'kuro-content');

  if (!dryRun) {
    await mkdir(outDir, { recursive: true });
  }

  if (validationErrors.length > 0) {
    console.warn('[kuro-content] VALIDATION FAILED:');
    for (const e of validationErrors) console.warn(`  - ${e}`);
    const draftPath = join(outDir, `${DATE}.md.draft`);
    if (!dryRun) {
      await writeFile(draftPath, generated, 'utf8');
      console.warn(`[kuro-content] wrote draft -> ${draftPath}`);
      console.warn('[kuro-content] live page will use placeholder (kuro-content not written)');
    } else {
      console.log('[kuro-content] dry-run: draft would be written to', draftPath);
    }
    process.exit(2);
  }

  // 7. Write output
  const outPath = join(outDir, `${DATE}.md`);
  if (!dryRun) {
    await writeFile(outPath, generated, 'utf8');
    console.log(`[kuro-content] wrote ${outPath}`);
  } else {
    console.log('[kuro-content] dry-run: content would be written to', outPath);
    console.log('[kuro-content] --- generated content preview (first 500 chars) ---');
    console.log(generated.slice(0, 500));
    console.log('[kuro-content] ---');
  }
}

main().catch(e => {
  console.error(`[kuro-content] FATAL: ${e.message}`);
  process.exit(1);
});
