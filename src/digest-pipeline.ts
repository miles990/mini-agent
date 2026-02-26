/**
 * Digest Pipeline
 *
 * Two pipelines in one module:
 *
 * 1. AI Research Digest — daily paper curation
 *    Fetch → Deduplicate → Filter (Haiku) → Summarize (Sonnet) → Format
 *
 * 2. Instant Digest — real-time content digestion (channel-agnostic)
 *    Content in → Detect type → Fetch URL → Classify + Summarize (Haiku) → Store → Reply
 *
 * Instant Digest is designed as an independent, API-first service.
 * Any channel (Telegram, HTTP, Webhook, CLI) feeds into the same pipeline.
 */

import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { slog } from './utils.js';
import { getInstanceDir, getCurrentInstanceId } from './instance.js';

// =============================================================================
// Types
// =============================================================================

export interface Paper {
  id: string;          // arXiv ID (e.g. "2402.12345")
  title: string;
  authors: string[];
  abstract: string;
  url: string;
  source: 'hf' | 'arxiv';
  score?: number;      // HF upvotes or relevance score
  publishedDate?: string;
}

export interface PaperSummary {
  paper: Paper;
  tldr: string;
  keyInsights: string[];
  whyItMatters: string;
}

export interface DigestResult {
  date: string;
  papers: PaperSummary[];
  todaysSignal: string;  // Cross-paper trend analysis
}

// =============================================================================
// Constants
// =============================================================================

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';
const SONNET_MODEL = 'claude-sonnet-4-6-20250514';

const HF_DAILY_PAPERS_URL = 'https://huggingface.co/api/daily_papers';
const ARXIV_API_URL = 'https://export.arxiv.org/api/query';

// =============================================================================
// Anthropic Client (shared singleton)
// =============================================================================

let client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic();
  }
  return client;
}

// =============================================================================
// Step 1: Fetch Papers
// =============================================================================

/** Fetch trending papers from HuggingFace Daily Papers API */
async function fetchHFPapers(limit = 100): Promise<Paper[]> {
  try {
    const resp = await fetch(`${HF_DAILY_PAPERS_URL}?limit=${limit}`);
    if (!resp.ok) {
      slog('DIGEST', `HF API failed: ${resp.status}`);
      return [];
    }

    const data = await resp.json() as Array<{
      paper: {
        id: string;
        title: string;
        summary: string;
        authors: Array<{ name: string }>;
      };
      title?: string;
      publishedAt?: string;
      numUpvotes?: number;
    }>;

    return data.map(item => ({
      id: item.paper.id,
      title: (item.paper.title || item.title || '').trim(),
      authors: item.paper.authors?.map(a => a.name) ?? [],
      abstract: (item.paper.summary || '').trim(),
      url: `https://arxiv.org/abs/${item.paper.id}`,
      source: 'hf' as const,
      score: item.numUpvotes ?? 0,
      publishedDate: item.publishedAt,
    }));
  } catch (err) {
    slog('DIGEST', `HF fetch error: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

/** Extract text content between XML tags */
function xmlText(xml: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = xml.match(re);
  return m ? m[1].trim() : '';
}

/** Extract all occurrences of a tag */
function xmlAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) results.push(m[1].trim());
  return results;
}

/** Fetch recent papers from arXiv API (cs.AI, cs.LG, cs.CL) */
async function fetchArxivPapers(maxResults = 50): Promise<Paper[]> {
  try {
    const query = '(cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CL)';
    const url = `${ARXIV_API_URL}?search_query=${query}&sortBy=submittedDate&sortOrder=descending&max_results=${maxResults}`;

    const resp = await fetch(url);
    if (!resp.ok) {
      slog('DIGEST', `arXiv API failed: ${resp.status}`);
      return [];
    }

    const xml = await resp.text();

    // Split into <entry>...</entry> blocks
    const entryBlocks = xml.split(/<entry>/i).slice(1); // skip preamble

    return entryBlocks.map(block => {
      const rawId = xmlText(block, 'id');
      const id = rawId.replace('http://arxiv.org/abs/', '').replace(/v\d+$/, '');
      const authors = xmlAll(block, 'name');

      return {
        id,
        title: xmlText(block, 'title').replace(/\s+/g, ' '),
        authors,
        abstract: xmlText(block, 'summary').replace(/\s+/g, ' '),
        url: `https://arxiv.org/abs/${id}`,
        source: 'arxiv' as const,
        publishedDate: xmlText(block, 'published'),
      };
    });
  } catch (err) {
    slog('DIGEST', `arXiv fetch error: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

/** Fetch from all sources and deduplicate */
export async function fetchPapers(): Promise<Paper[]> {
  const [hfPapers, arxivPapers] = await Promise.all([
    fetchHFPapers(),
    fetchArxivPapers(),
  ]);

  slog('DIGEST', `Fetched: HF=${hfPapers.length}, arXiv=${arxivPapers.length}`);

  // Deduplicate by arXiv ID, prefer HF (has upvote data)
  const seen = new Map<string, Paper>();
  for (const p of hfPapers) seen.set(p.id, p);
  for (const p of arxivPapers) {
    if (!seen.has(p.id)) seen.set(p.id, p);
  }

  const papers = [...seen.values()];
  slog('DIGEST', `After dedup: ${papers.length} unique papers`);
  return papers;
}

// =============================================================================
// Step 2: Filter with Haiku
// =============================================================================

/** Use Haiku to select top N papers from candidates */
export async function filterPapers(papers: Paper[], topN = 5): Promise<Paper[]> {
  if (!process.env.ANTHROPIC_API_KEY) {
    slog('DIGEST', 'No ANTHROPIC_API_KEY, using score-based fallback');
    return papers
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, topN);
  }

  if (papers.length <= topN) return papers;

  // Prepare compact paper list for Haiku
  const paperList = papers.map((p, i) =>
    `[${i}] ${p.title}\n    ${p.abstract.slice(0, 200)}...${p.score ? ` (upvotes: ${p.score})` : ''}`
  ).join('\n');

  try {
    const start = Date.now();
    const response = await getClient().messages.create({
      model: HAIKU_MODEL,
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `You are an AI research curator. Select the ${topN} most important papers from today's list.

Criteria:
- Novelty: new techniques, architectures, or findings
- Impact: likely to influence the field
- Practical: applicable to real-world AI development
- Diversity: cover different subfields (not all about the same topic)

Papers:
${paperList}

Reply with ONLY the indices as comma-separated numbers (e.g. "3,7,12,21,45"). No explanation.`,
      }],
    });

    const elapsed = Date.now() - start;
    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';

    // Parse indices
    const indices = text
      .split(/[,\s]+/)
      .map(s => parseInt(s.replace(/[[\]]/g, ''), 10))
      .filter(n => !isNaN(n) && n >= 0 && n < papers.length);

    if (indices.length === 0) {
      slog('DIGEST', `Haiku filter returned no valid indices, using fallback`);
      return papers.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, topN);
    }

    const selected = indices.slice(0, topN).map(i => papers[i]);
    slog('DIGEST', `Haiku filtered ${papers.length} → ${selected.length} papers (${elapsed}ms)`);
    return selected;
  } catch (err) {
    slog('DIGEST', `Haiku filter failed: ${err instanceof Error ? err.message : err}`);
    return papers.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, topN);
  }
}

// =============================================================================
// Step 3: Summarize with Sonnet
// =============================================================================

/** Use Sonnet for deep summaries + cross-paper analysis */
export async function summarizePapers(papers: Paper[], lang: 'en' | 'zh' = 'en'): Promise<DigestResult> {
  const today = new Date().toISOString().slice(0, 10);

  if (!process.env.ANTHROPIC_API_KEY) {
    slog('DIGEST', 'No ANTHROPIC_API_KEY, using basic summaries');
    return {
      date: today,
      papers: papers.map(p => ({
        paper: p,
        tldr: p.abstract.slice(0, 150) + '...',
        keyInsights: ['See full abstract for details'],
        whyItMatters: 'Read the paper for more context.',
      })),
      todaysSignal: 'API key not available for cross-paper analysis.',
    };
  }

  const paperDetails = papers.map((p, i) =>
    `Paper ${i + 1}: "${p.title}"
Authors: ${p.authors.slice(0, 3).join(', ')}${p.authors.length > 3 ? ' et al.' : ''}
Abstract: ${p.abstract}
URL: ${p.url}`
  ).join('\n\n');

  try {
    const start = Date.now();
    const response = await getClient().messages.create({
      model: SONNET_MODEL,
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `You are an AI research analyst. Summarize these ${papers.length} papers for a technical audience.
${lang === 'zh' ? '\nIMPORTANT: Write ALL text (tldr, keyInsights, whyItMatters, todaysSignal) in Traditional Chinese (繁體中文). Keep paper titles, author names, and technical terms in English.\n' : ''}
For EACH paper, provide:
1. TL;DR (one sentence, what they did and found)
2. Key Insights (2-3 bullet points)
3. Why It Matters (one sentence on practical impact)

After all papers, write a "Today's Signal" section: identify the overarching trend or theme connecting these papers. What direction is the field moving?

Format your response as JSON:
{
  "papers": [
    {
      "index": 0,
      "tldr": "...",
      "keyInsights": ["...", "..."],
      "whyItMatters": "..."
    }
  ],
  "todaysSignal": "..."
}

Papers:
${paperDetails}`,
      }],
    });

    const elapsed = Date.now() - start;
    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '';

    // Parse JSON — tolerant of markdown fencing
    const jsonStr = text.replace(/^```json?\s*/, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(jsonStr) as {
      papers: Array<{
        index: number;
        tldr: string;
        keyInsights: string[];
        whyItMatters: string;
      }>;
      todaysSignal: string;
    };

    const summaries: PaperSummary[] = parsed.papers.map(s => ({
      paper: papers[s.index] ?? papers[0],
      tldr: s.tldr,
      keyInsights: s.keyInsights,
      whyItMatters: s.whyItMatters,
    }));

    slog('DIGEST', `Sonnet summarized ${papers.length} papers (${elapsed}ms)`);

    return {
      date: today,
      papers: summaries,
      todaysSignal: parsed.todaysSignal,
    };
  } catch (err) {
    slog('DIGEST', `Sonnet summarize failed: ${err instanceof Error ? err.message : err}`);
    // Fallback to basic summaries
    return {
      date: today,
      papers: papers.map(p => ({
        paper: p,
        tldr: p.abstract.slice(0, 150) + '...',
        keyInsights: ['See full abstract'],
        whyItMatters: 'Read the paper for details.',
      })),
      todaysSignal: 'Summarization failed — showing raw abstracts.',
    };
  }
}

// =============================================================================
// Step 4: Format for Telegram
// =============================================================================

/** Format digest as Telegram-friendly Markdown */
export function formatDigest(digest: DigestResult, lang: 'en' | 'zh' = 'en'): string {
  const header = lang === 'zh'
    ? `🔬 *AI 研究摘要 — ${digest.date}*\n`
    : `🔬 *AI Research Digest — ${digest.date}*\n`;

  const paperSections = digest.papers.map((s, i) => {
    const insights = s.keyInsights.map(k => `  • ${k}`).join('\n');
    return `*${i + 1}. ${escapeMd(s.paper.title)}*
${escapeMd(s.tldr)}

${insights}

💡 ${escapeMd(s.whyItMatters)}
🔗 ${s.paper.url}`;
  }).join('\n\n---\n\n');

  const signalLabel = lang === 'zh' ? '今日趨勢' : "Today's Signal";
  const signal = `\n\n📡 *${signalLabel}*\n${escapeMd(digest.todaysSignal)}`;

  return header + '\n' + paperSections + signal;
}

/** Escape Markdown special chars for Telegram */
function escapeMd(text: string): string {
  // Telegram Markdown v1 only needs _ * [ ] escaping
  return text.replace(/([_*[\]])/g, '\\$1');
}

// =============================================================================
// Main Pipeline
// =============================================================================

/** Run the complete daily digest pipeline */
export async function runDailyDigest(lang: 'en' | 'zh' = 'en'): Promise<DigestResult> {
  slog('DIGEST', `=== Starting daily digest pipeline (lang=${lang}) ===`);

  const papers = await fetchPapers();
  if (papers.length === 0) {
    slog('DIGEST', 'No papers fetched, aborting');
    return { date: new Date().toISOString().slice(0, 10), papers: [], todaysSignal: 'No papers available today.' };
  }

  const filtered = await filterPapers(papers, 5);
  const digest = await summarizePapers(filtered, lang);

  slog('DIGEST', `=== Digest complete: ${digest.papers.length} papers ===`);
  return digest;
}

// =============================================================================
// Instant Digest — Real-time content digestion (channel-agnostic)
// =============================================================================

/**
 * Detect if a message should go through the fast digest path (skip OODA).
 * Works on raw message text (before any prefix processing).
 */
export function isDigestContent(text: string, hasForward: boolean): boolean {
  if (hasForward) return true;
  if (text.startsWith('/d ') || text.startsWith('/d\n')) return true;
  const trimmed = text.trim();
  // Pure URL or text containing a URL
  if (/https?:\/\/\S+/.test(trimmed)) return true;
  return false;
}

const CATEGORY_EMOJI: Record<string, string> = {
  ai: '🤖', design: '🎨', tech: '⚙️', business: '💼',
  culture: '🎭', personal: '📝', other: '📌',
};

/** Format a single digest entry as instant reply (for Telegram / Chat Room) */
export function formatInstantReply(entry: DigestEntry): string {
  const emoji = CATEGORY_EMOJI[entry.category] ?? '📌';
  let reply = `📋 ${emoji} ${entry.category.toUpperCase()} — ${entry.summary}`;
  if (entry.tags.length > 0) reply += `\n🏷️ ${entry.tags.join(', ')}`;
  if (entry.needsDepth) reply += `\n\n🔍 這個主題有深度，我會在下次 cycle 補充完整分析。`;
  return reply;
}

export interface DigestRequest {
  content: string;
  url?: string;
  type?: 'forward' | 'url' | 'note' | 'voice' | 'image';
  channel?: string;
  metadata?: Record<string, unknown>;
}

export interface DigestEntry {
  id: string;                  // d-YYYY-MM-DD-NNN
  ts: string;                  // ISO timestamp
  channel: string;
  type: string;
  category: string;
  source?: string;
  summary: string;
  content: string;             // Original (truncated to 2000 chars)
  url?: string;
  tags: string[];
  needsDepth: boolean;         // Whether this content warrants deeper OODA analysis
  metadata?: Record<string, unknown>;
}

const CATEGORIES = ['ai', 'design', 'tech', 'business', 'culture', 'personal', 'other'] as const;

/** Get the JSONL storage path for digest entries */
function getDigestStorePath(): string {
  return path.join(getInstanceDir(getCurrentInstanceId()), 'digest.jsonl');
}

/** Generate next digest entry ID for today */
function nextDigestId(): string {
  const today = new Date().toISOString().slice(0, 10);
  const storePath = getDigestStorePath();

  let count = 0;
  try {
    if (fs.existsSync(storePath)) {
      const lines = fs.readFileSync(storePath, 'utf-8').split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const entry = JSON.parse(line) as DigestEntry;
          if (entry.id.startsWith(`d-${today}-`)) count++;
        } catch { /* skip malformed lines */ }
      }
    }
  } catch { /* file not found */ }

  return `d-${today}-${String(count + 1).padStart(3, '0')}`;
}

/** Try to fetch and extract text content from a URL */
async function fetchUrlContent(url: string): Promise<string> {
  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; InstantDigest/1.0)' },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) return '';

    const contentType = resp.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain') && !contentType.includes('application/json')) {
      return `[Non-text content: ${contentType}]`;
    }

    const html = await resp.text();

    // Simple HTML → text extraction (strip tags, decode entities)
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

    return text.slice(0, 5000);
  } catch (err) {
    slog('INSTANT-DIGEST', `URL fetch failed: ${err instanceof Error ? err.message : err}`);
    return '';
  }
}

/** Core: classify + summarize content using Haiku */
export async function digestContent(req: DigestRequest): Promise<DigestEntry> {
  const start = Date.now();
  const id = nextDigestId();
  const ts = new Date().toISOString();

  // Resolve content: if URL provided and no content, fetch it
  let resolvedContent = req.content;
  if (req.url && (!resolvedContent || resolvedContent === req.url)) {
    const fetched = await fetchUrlContent(req.url);
    if (fetched) {
      resolvedContent = fetched;
    }
  }

  const truncatedContent = resolvedContent.slice(0, 2000);

  // If no API key, return basic entry without LLM
  if (!process.env.ANTHROPIC_API_KEY) {
    const entry: DigestEntry = {
      id, ts,
      channel: req.channel ?? 'api',
      type: req.type ?? 'note',
      category: 'other',
      summary: truncatedContent.slice(0, 200) + (truncatedContent.length > 200 ? '...' : ''),
      content: truncatedContent,
      url: req.url,
      tags: [],
      needsDepth: false,
      metadata: req.metadata,
    };
    storeDigestEntry(entry);
    return entry;
  }

  // Use Haiku for fast classify + summarize
  try {
    const response = await getClient().messages.create({
      model: HAIKU_MODEL,
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Classify and summarize this content. Reply in JSON only, no markdown fencing.

Content:
${truncatedContent}
${req.url ? `\nURL: ${req.url}` : ''}

JSON format:
{"category":"${CATEGORIES.join('|')}","summary":"一句話摘要（繁體中文）","tags":["tag1","tag2"],"needsDepth":true/false}

Rules:
- summary: one sentence in Traditional Chinese, capture the key point
- category: pick the best fit from the list
- tags: 1-3 lowercase English keywords
- needsDepth: true if the content is complex, controversial, multi-faceted, or would benefit from deeper analysis (e.g. research papers, long articles, nuanced topics). false for simple news, announcements, or self-explanatory content`,
      }],
    });

    const elapsed = Date.now() - start;
    const text = response.content[0].type === 'text' ? response.content[0].text.trim() : '{}';

    // Parse JSON — tolerant of markdown fencing
    const jsonStr = text.replace(/^```json?\s*/, '').replace(/\s*```$/, '').trim();
    const parsed = JSON.parse(jsonStr) as {
      category?: string;
      summary?: string;
      tags?: string[];
      needsDepth?: boolean;
    };

    const entry: DigestEntry = {
      id, ts,
      channel: req.channel ?? 'api',
      type: req.type ?? 'note',
      category: CATEGORIES.includes(parsed.category as typeof CATEGORIES[number]) ? parsed.category! : 'other',
      summary: parsed.summary ?? truncatedContent.slice(0, 200),
      content: truncatedContent,
      url: req.url,
      tags: Array.isArray(parsed.tags) ? parsed.tags.slice(0, 5) : [],
      needsDepth: parsed.needsDepth === true,
      metadata: req.metadata,
    };

    storeDigestEntry(entry);
    slog('INSTANT-DIGEST', `${id} [${entry.category}] ${entry.summary.slice(0, 60)}... (${elapsed}ms)`);
    return entry;
  } catch (err) {
    slog('INSTANT-DIGEST', `LLM failed: ${err instanceof Error ? err.message : err}`);
    // Fallback: store without LLM classification
    const entry: DigestEntry = {
      id, ts,
      channel: req.channel ?? 'api',
      type: req.type ?? 'note',
      category: 'other',
      summary: truncatedContent.slice(0, 200) + (truncatedContent.length > 200 ? '...' : ''),
      content: truncatedContent,
      url: req.url,
      tags: [],
      needsDepth: false,
      metadata: req.metadata,
    };
    storeDigestEntry(entry);
    return entry;
  }
}

/** Append a digest entry to JSONL storage */
function storeDigestEntry(entry: DigestEntry): void {
  try {
    const storePath = getDigestStorePath();
    fs.appendFileSync(storePath, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (err) {
    slog('INSTANT-DIGEST', `Store failed: ${err instanceof Error ? err.message : err}`);
  }
}

/** Read all digest entries for a given date */
export function getDigestEntries(date?: string): DigestEntry[] {
  const targetDate = date ?? new Date().toISOString().slice(0, 10);
  const storePath = getDigestStorePath();
  const entries: DigestEntry[] = [];

  try {
    if (!fs.existsSync(storePath)) return [];
    const lines = fs.readFileSync(storePath, 'utf-8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as DigestEntry;
        if (entry.ts.startsWith(targetDate)) {
          entries.push(entry);
        }
      } catch { /* skip malformed */ }
    }
  } catch { /* file not found */ }

  return entries;
}

/** Generate a formatted daily summary of all instant digest entries */
export async function generateInstantDailyDigest(date?: string): Promise<string> {
  const targetDate = date ?? new Date().toISOString().slice(0, 10);
  const entries = getDigestEntries(targetDate);

  if (entries.length === 0) {
    return `📋 ${targetDate} — 今天沒有消化的內容。`;
  }

  // Group by category
  const byCategory = new Map<string, DigestEntry[]>();
  for (const e of entries) {
    const cat = e.category;
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(e);
  }

  const categoryEmoji: Record<string, string> = {
    ai: '🤖', design: '🎨', tech: '💻', business: '💼',
    culture: '🎭', personal: '📝', other: '📌',
  };

  let output = `📋 *每日消化 — ${targetDate}*\n共 ${entries.length} 則\n`;

  for (const [cat, catEntries] of byCategory) {
    const emoji = categoryEmoji[cat] ?? '📌';
    output += `\n${emoji} *${cat.toUpperCase()}* (${catEntries.length})\n`;
    for (const e of catEntries) {
      output += `• ${escapeMd(e.summary)}`;
      if (e.url) output += ` [🔗](${e.url})`;
      output += '\n';
    }
  }

  return output;
}
