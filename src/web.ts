/**
 * Built-in Web Capabilities — zero-dependency web fetch + search
 *
 * Uses Node's built-in fetch API. No external tools required.
 * For advanced web access (CDP, Grok, etc.), use plugins/web-fetch.sh.
 */

import { slog, diagLog } from './utils.js';
import { eventBus } from './event-bus.js';

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
      // Retry once on server errors (5xx)
      if (res.status >= 500 && !options?._retried) {
        slog('WEB', `Retry ${url} after ${error}`);
        return fetchPage(url, { ...options, _retried: true });
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

    // Quality check: suspiciously short HTML content = likely blocked/login-wall
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
    // Retry once on timeout
    if (err instanceof Error && err.name === 'AbortError' && !options?._retried) {
      slog('WEB', `Retry ${url} after timeout`);
      return fetchPage(url, { ...options, timeout: timeout * 1.5, _retried: true });
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

/**
 * Fetch all requested URLs and return results as markdown sections.
 * Results are stored in memory state dir for the next cycle to pick up.
 */
export async function processFetchRequests(
  requests: FetchRequest[],
  stateDir: string,
): Promise<void> {
  if (requests.length === 0) return;

  const results: FetchResult[] = [];
  const fetches = requests.slice(0, 5); // cap at 5 concurrent fetches

  await Promise.all(
    fetches.map(async (req) => {
      const result = await fetchPage(req.url);
      results.push(result);
      slog('WEB', `${result.error ? '✗' : '✓'} ${req.url} (${result.byteLength}B)`);
    }),
  );

  // Write results to state dir for next cycle injection
  const { writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');

  const output = results.map((r) => {
    if (r.error) return `### ${r.url}\nError: ${r.error}\n`;
    const titleLine = r.title ? `## ${r.title}\n` : '';
    // Cap each result at 8000 chars to keep context manageable
    const content = r.text.length > 8000 ? r.text.slice(0, 8000) + '\n[... truncated]' : r.text;
    return `${titleLine}Source: ${r.url}\n\n${content}`;
  }).join('\n\n---\n\n');

  await writeFile(join(stateDir, 'web-fetch-results.md'), output, 'utf-8');
}
