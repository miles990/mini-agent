/**
 * Built-in Web Capabilities — multi-layer web fetch + search
 *
 * Fallback chain:
 *   X/Twitter URLs: Grok API → gsd-browser → CDP → plain HTTP
 *   General URLs:   gsd-browser → CDP → plain HTTP
 */

import { readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { slog, diagLog } from './utils.js';
import { eventBus } from './event-bus.js';

// =============================================================================
// Web cache dedup — read-only view of inbox.ts's prefetch cache
// =============================================================================
//
// inbox.ts already prefetches URLs from incoming messages into ~/.mini-agent/web-cache/
// with 1h TTL. We reuse that cache here so <kuro:fetch> for the same URL within a short
// window returns the prefetched content instead of doing the work again.
//
// The hash function MUST stay in sync with inbox.ts:urlToHash (md5, first 12 hex chars).

const WEB_CACHE_DIR = join(homedir(), '.mini-agent', 'web-cache');
const FETCH_DEDUP_TTL_MS = 5 * 60 * 1000; // 5 min — same URL within this window reuses cache

function readWebCacheFresh(url: string): { text: string; title?: string; ageMs: number } | null {
  try {
    const hash = createHash('md5').update(url).digest('hex').slice(0, 12);
    const cachePath = join(WEB_CACHE_DIR, `${hash}.txt`);
    if (!existsSync(cachePath)) return null;
    const stat = statSync(cachePath);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > FETCH_DEDUP_TTL_MS) return null;
    const content = readFileSync(cachePath, 'utf-8');
    const bodyStart = content.indexOf('---\n');
    if (bodyStart < 0) return null;
    const header = content.slice(0, bodyStart);
    const titleMatch = header.match(/^Title: (.+)$/m);
    const text = content.slice(bodyStart + 4).trim();
    if (text.length < 50) return null;
    return { text, title: titleMatch?.[1], ageMs };
  } catch {
    return null;
  }
}

// =============================================================================
// Grok API — X/Twitter fetch (primary for x.com / twitter.com URLs)
// =============================================================================

function xaiKey(): string | undefined {
  if (process.env['XAI_API_KEY']) return process.env['XAI_API_KEY'];
  try {
    const content = readFileSync(join(process.cwd(), '.env'), 'utf-8');
    const m = content.match(/^XAI_API_KEY=(.+)$/m);
    return m?.[1]?.replace(/\s*#.*$/, '').trim();
  } catch { return undefined; }
}

async function grokFetch(url: string): Promise<string | null> {
  const apiKey = xaiKey();
  if (!apiKey) return null;
  try {
    const isArticle = /x\.com\/i\/article|x\.com\/\w+\/article/i.test(url);
    const instructions = isArticle
      ? 'Read this X article in full. Return the complete text content, author, and any key points. Plain text, no markdown.'
      : 'Read this tweet/post and return its full content: author, text, engagement stats. If it quotes or links to another post/article, include that too. Plain text, no markdown.';
    const resp = await fetch('https://api.x.ai/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'grok-4',
        tools: [{ type: 'x_search' }],
        instructions,
        input: url,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!resp.ok) return null;
    const data = await resp.json() as { output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }> };
    const msg = data.output?.find(o => o.type === 'message');
    const text = msg?.content?.find(c => c.type === 'output_text')?.text;
    return text && text.length > 50 ? text : null;
  } catch { return null; }
}

// =============================================================================
// gsd-browser — Rust browser automation CLI (headless Chrome)
// =============================================================================

function execAsync(cmd: string, args: string[], timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
    child.stdin?.end();
  });
}

async function gsdBrowserFetch(url: string): Promise<string | null> {
  try {
    // Navigate and wait for network idle
    await execAsync('gsd-browser', ['navigate', url], 30_000);
    await execAsync('gsd-browser', ['wait-for', '--condition', 'network_idle'], 15_000);
    // Extract readable text via JS eval
    const text = await execAsync('gsd-browser', [
      'eval',
      `(function(){const a=document.querySelector('article,main,[role="main"],.content,#content');const t=(a||document.body).innerText;return t})()`,
    ], 10_000);
    const clean = text.trim();
    if (clean.length > 100) return clean;
    return null;
  } catch {
    return null;
  }
}

// =============================================================================
// CDP — Chrome DevTools Protocol via cdp-fetch.mjs
// =============================================================================

const CDP_FETCH_SCRIPT = join(process.cwd(), 'scripts', 'cdp-fetch.mjs');

async function cdpFetch(url: string): Promise<string | null> {
  try {
    const stdout = await execAsync('node', [CDP_FETCH_SCRIPT, 'fetch', url], 30_000);
    const text = stdout.trim();
    if (text.length > 100) return text;
    return null;
  } catch {
    return null;
  }
}

// =============================================================================
// Types
// =============================================================================

export interface FetchResult {
  url: string;
  title: string;
  text: string;
  byteLength: number;
  fetchedAt: string;
  error?: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// =============================================================================
// fetchPage — fetch URL and extract readable text
// =============================================================================

export async function fetchPage(
  url: string,
  options?: { timeout?: number; maxLength?: number; _retried?: boolean },
): Promise<FetchResult> {
  const timeout = options?.timeout ?? 15_000;
  const maxLength = options?.maxLength ?? 50_000;

  let hostname = '';
  try { hostname = new URL(url).hostname; } catch { /* invalid URL — let fetch fail naturally */ }

  // ── Gate 1: skip domains with repeated content restrictions ──
  try {
    const { readState } = await import('./feedback-loops.js');
    const health = readState<{ fetchHealth: { restrictedDomains: string[] } }>('system-health.json', { fetchHealth: { restrictedDomains: [] } });
    if (hostname && health.fetchHealth.restrictedDomains.includes(hostname)) {
      slog('WEB', `⛔ skipped restricted domain: ${hostname}`);
      return { url, title: '', text: '', byteLength: 0, fetchedAt: new Date().toISOString(), error: `Domain ${hostname} is restricted (3+ content_restricted failures)` };
    }
  } catch { /* best effort — don't block fetch if check fails */ }

  // ── Gate 2: nutrient router — skip pruned domains ──
  try {
    if (hostname) {
      const { getRouteDecision } = await import('./nutrient-router.js');
      const decision = getRouteDecision(hostname);
      if (decision.action === 'skip') {
        slog('WEB', `🍂 pruned by nutrient router: ${hostname} (score ${decision.score}, ${decision.reason})`);
        return { url, title: '', text: '', byteLength: 0, fetchedAt: new Date().toISOString(), error: `Domain ${hostname} pruned by nutrient router (${decision.reason})` };
      }
    }
  } catch { /* best effort */ }

  // ── Gate 3: dedup — reuse fresh cache from inbox prefetch ──
  // If the same URL was fetched within FETCH_DEDUP_TTL_MS (5 min), return the cached
  // body without re-running the fetch chain. This is the primary defence against
  // <kuro:fetch> repeating itself when an Alex-shared URL is already in inbox prefetch cache.
  {
    const cached = readWebCacheFresh(url);
    if (cached) {
      slog('WEB', `↺ ${url} from cache (${cached.text.length}B, ${(cached.ageMs / 1000).toFixed(0)}s old)`);
      const result = makeResult(url, cached.title ?? '', cached.text, maxLength, 'cache');
      return result;
    }
  }

  const isXTwitter = /x\.com|twitter\.com/i.test(url);

  // Helper: log fetch outcome to nutrient router (fire-and-forget)
  let _logFetch: typeof import('./nutrient-router.js').logFetch | null = null;
  try { _logFetch = (await import('./nutrient-router.js')).logFetch; } catch { /* best effort */ }
  const logNutrient = (result: FetchResult, method: string) => {
    try {
      if (hostname && _logFetch) {
        _logFetch(hostname, url, method, result.byteLength, result.text.length, !result.error);
      }
    } catch { /* fire-and-forget */ }
  };

  // ── Layer 1 (X/Twitter only): Grok API — native X access, no login wall ──
  if (isXTwitter) {
    const grokText = await grokFetch(url);
    if (grokText) {
      slog('WEB', `✓ ${url} via grok (${grokText.length}B)`);
      const result = makeResult(url, '', grokText, maxLength, 'grok');
      logNutrient(result, 'grok');
      return result;
    }
    slog('WEB', `grok miss for ${url}, trying gsd-browser`);
  }

  // ── Layer 2: gsd-browser — headless Chrome with full JS rendering ──
  const gsdText = await gsdBrowserFetch(url);
  if (gsdText) {
    slog('WEB', `✓ ${url} via gsd-browser (${gsdText.length}B)`);
    const result = makeResult(url, '', gsdText, maxLength, 'gsd-browser');
    logNutrient(result, 'gsd-browser');
    return result;
  }
  slog('WEB', `gsd-browser miss for ${url}, trying cdp`);

  // ── Layer 3: CDP — Chrome DevTools Protocol via cdp-fetch.mjs ──
  const cdpText = await cdpFetch(url);
  if (cdpText) {
    slog('WEB', `✓ ${url} via cdp (${cdpText.length}B)`);
    const result = makeResult(url, '', cdpText, maxLength, 'cdp');
    logNutrient(result, 'cdp');
    return result;
  }
  slog('WEB', `cdp miss for ${url}, falling back to http`);

  // ── Layer 4: Plain HTTP — last resort ──
  const result = await plainHttpFetch(url, { timeout, maxLength, _retried: options?._retried });
  logNutrient(result, 'http');
  return result;
}

function makeResult(url: string, title: string, text: string, maxLength: number, _layer: string): FetchResult {
  const truncated = text.length > maxLength ? text.slice(0, maxLength) + '\n\n[... truncated]' : text;
  return { url, title, text: truncated, byteLength: text.length, fetchedAt: new Date().toISOString() };
}

async function plainHttpFetch(
  url: string,
  opts: { timeout: number; maxLength: number; _retried?: boolean },
): Promise<FetchResult> {
  const { timeout, maxLength } = opts;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; mini-agent/1.0)',
        'Accept': 'text/html,application/xhtml+xml,text/plain,application/json',
      },
      redirect: 'follow',
    });

    clearTimeout(timer);

    if (!res.ok) {
      const error = `HTTP ${res.status}`;
      if (res.status >= 500 && !opts._retried) {
        slog('WEB', `Retry ${url} after ${error}`);
        return plainHttpFetch(url, { ...opts, _retried: true });
      }
      eventBus.emit('log:info', { tag: 'web-fetch', msg: `${error}: ${url}` });
      return { url, title: '', text: '', byteLength: 0, fetchedAt: new Date().toISOString(), error };
    }

    const contentType = res.headers.get('content-type') ?? '';
    const rawText = await res.text();

    let title = '';
    let text = rawText;

    if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
      title = extractTitle(rawText);
      text = extractReadableText(rawText);
    } else if (contentType.includes('application/json')) {
      try {
        text = JSON.stringify(JSON.parse(rawText), null, 2);
      } catch { /* keep raw */ }
    }

    if (contentType.includes('text/html') && text.length < 200 && rawText.length > 1000) {
      slog('WEB', `⚠ ${url}: extracted only ${text.length} chars from ${rawText.length}B HTML — possible login wall`);
    }

    if (text.length > maxLength) {
      text = text.slice(0, maxLength) + '\n\n[... truncated]';
    }

    return { url, title, text, byteLength: rawText.length, fetchedAt: new Date().toISOString() };
  } catch (err: unknown) {
    const error = err instanceof Error
      ? (err.name === 'AbortError' ? 'Timeout' : err.message)
      : 'Unknown error';
    if (err instanceof Error && err.name === 'AbortError' && !opts._retried) {
      slog('WEB', `Retry ${url} after timeout`);
      return plainHttpFetch(url, { ...opts, timeout: timeout * 1.5, _retried: true });
    }
    eventBus.emit('log:info', { tag: 'web-fetch', msg: `${error}: ${url}` });
    return { url, title: '', text: '', byteLength: 0, fetchedAt: new Date().toISOString(), error };
  }
}

// =============================================================================
// searchWeb — SearXNG local instance (graceful fallback)
// =============================================================================

export async function searchWeb(
  query: string,
  options?: { maxResults?: number; searxngUrl?: string },
): Promise<SearchResult[]> {
  const maxResults = options?.maxResults ?? 5;
  const baseUrl = options?.searxngUrl ?? 'http://localhost:8080';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);

    const params = new URLSearchParams({ q: query, format: 'json' });
    const res = await fetch(`${baseUrl}/search?${params}`, {
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (res.ok) {
      const data = (await res.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
      return (data.results ?? []).slice(0, maxResults).map((r) => ({
        title: r.title ?? '',
        url: r.url ?? '',
        snippet: r.content ?? '',
      }));
    }
  } catch (err: unknown) {
    diagLog('searchWeb', err instanceof Error ? err : new Error('SearXNG unavailable'));
  }

  return [];
}

// =============================================================================
// HTML → readable text extraction
// =============================================================================

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeEntities(match[1].trim()) : '';
}

export function extractReadableText(html: string): string {
  let text = html;

  // Remove non-content blocks
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<noscript[\s\S]*?<\/noscript>/gi, '');
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  text = text.replace(/<header[\s\S]*?<\/header>/gi, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // Convert structural elements to markdown-ish
  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, _l, c) => `\n${'#'.repeat(Number(_l))} ${c.trim()}\n`);
  text = text.replace(/<p[^>]*>/gi, '\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<li[^>]*>/gi, '- ');
  text = text.replace(/<\/li>/gi, '\n');
  text = text.replace(/<blockquote[^>]*>/gi, '\n> ');
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)');

  // Remove remaining tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode HTML entities
  text = decodeEntities(text);

  // Normalize whitespace
  text = text.replace(/[ \t]+/g, ' ');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.trim();

  return text;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCharCode(parseInt(code, 16)));
}

// =============================================================================
// processFetchTags — handle <kuro:fetch> results (called from postProcess)
// =============================================================================

export interface FetchRequest {
  url: string;
  label?: string;
}

// Shared constants for web-fetch-results pool (used by processFetchRequests + readFetchedEntries).
const FETCH_ENTRY_SEP = '\n\n---FETCH-ENTRY---\n\n';
const FETCH_ENTRY_TTL_MS = 10 * 60 * 1000;
const FETCH_ENTRY_HEADER_RE = /^<!-- url: (.+) fetchedAt: (\S+) -->\n([\s\S]*)$/;

export interface FetchedEntry {
  url: string;
  fetchedAt: string; // ISO
  ageMs: number;     // filled at read time
  markdown: string;  // stored body (title + source line + content)
}

/**
 * Read the currently-live entries from web-fetch-results.md.
 *
 * Returns parsed per-URL entries filtered by TTL (10 min). Used by:
 *   - dispatcher (watermark gate: skip re-fetch of URL within TTL)
 *   - memory.ts (structured "Already-fetched URLs" annotation in context)
 *
 * Parse mirrors the writer in processFetchRequests. Kept in sync via the
 * shared FETCH_ENTRY_* constants above.
 */
export async function readFetchedEntries(stateDir: string): Promise<FetchedEntry[]> {
  const { readFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const filePath = join(stateDir, 'web-fetch-results.md');
  const now = Date.now();
  try {
    const raw = await readFile(filePath, 'utf-8');
    if (!raw.trim()) return [];
    const cutoff = now - FETCH_ENTRY_TTL_MS;
    const out: FetchedEntry[] = [];
    for (const block of raw.split(FETCH_ENTRY_SEP)) {
      const m = block.match(FETCH_ENTRY_HEADER_RE);
      if (!m) continue;
      const ts = Date.parse(m[2]);
      if (Number.isNaN(ts) || ts < cutoff) continue;
      out.push({ url: m[1], fetchedAt: m[2], ageMs: now - ts, markdown: m[3] });
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Fetch all requested URLs and merge into the persistent results file.
 *
 * Design: append-with-dedup, NOT overwrite.
 *   - New results replace prior entries for the SAME URL (latest wins).
 *   - Other recent entries are preserved (so two consecutive fetches don't lose each other).
 *   - Total entries capped at 5; entries older than 10 min are dropped.
 *   - Lifetime is owned by buildContext()'s TTL filter, not by this writer.
 */
export async function processFetchRequests(
  requests: FetchRequest[],
  stateDir: string,
): Promise<void> {
  if (requests.length === 0) return;

  const fetches = requests.slice(0, 5); // cap at 5 concurrent fetches

  const newResults: FetchResult[] = [];
  await Promise.all(
    fetches.map(async (req) => {
      const result = await fetchPage(req.url);
      newResults.push(result);
      slog('WEB', `${result.error ? '✗' : '✓'} ${req.url} (${result.byteLength}B)`);
    }),
  );

  const { readFile, writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const filePath = join(stateDir, 'web-fetch-results.md');

  const ENTRY_TTL_MS = 10 * 60 * 1000;
  const MAX_ENTRIES = 5;
  const SEP = '\n\n---FETCH-ENTRY---\n\n';

  type Entry = { url: string; fetchedAt: string; markdown: string };

  // Read existing entries (if any) and parse via the SEP marker.
  const existing: Entry[] = [];
  try {
    const raw = await readFile(filePath, 'utf-8');
    if (raw.trim()) {
      const cutoff = Date.now() - ENTRY_TTL_MS;
      for (const block of raw.split(SEP)) {
        const m = block.match(/^<!-- url: (.+) fetchedAt: (\S+) -->\n([\s\S]*)$/);
        if (!m) continue;
        const url = m[1];
        const fetchedAt = m[2];
        const ts = Date.parse(fetchedAt);
        if (Number.isNaN(ts) || ts < cutoff) continue;
        existing.push({ url, fetchedAt, markdown: m[3] });
      }
    }
  } catch { /* file doesn't exist — fine */ }

  // Build new entries; latest wins for duplicate URLs.
  const newUrls = new Set(newResults.map((r) => r.url));
  const merged: Entry[] = existing.filter((e) => !newUrls.has(e.url));

  for (const r of newResults) {
    const titleLine = r.title ? `## ${r.title}\n` : '';
    const body = r.error
      ? `Error: ${r.error}`
      : (r.text.length > 8000 ? r.text.slice(0, 8000) + '\n[... truncated]' : r.text);
    const markdown = `${titleLine}Source: ${r.url}\n\n${body}`;
    merged.push({ url: r.url, fetchedAt: r.fetchedAt, markdown });
  }

  // Cap at MAX_ENTRIES, prefer most recent (parse fetchedAt).
  merged.sort((a, b) => Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt));
  const kept = merged.slice(0, MAX_ENTRIES);

  const serialized = kept
    .map((e) => `<!-- url: ${e.url} fetchedAt: ${e.fetchedAt} -->\n${e.markdown}`)
    .join(SEP);

  await writeFile(filePath, serialized, 'utf-8');
}
