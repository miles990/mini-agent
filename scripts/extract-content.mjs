#!/usr/bin/env node
// Content extractor using Mozilla Readability + JSDOM + Turndown (Markdown)
// Usage: echo "<html>..." | node scripts/extract-content.mjs [--url URL]
//   or:  node scripts/extract-content.mjs --url URL --fetch
// Output: Line 1 = title, Line 2+ = clean markdown content
//
// Three-layer extraction:
//   1. Readability → Turndown markdown (best quality)
//   2. Readability → plain text fallback
//   3. Body text extraction (last resort)

import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';

const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const url = urlIdx !== -1 ? args[urlIdx + 1] : 'https://example.com';
const doFetch = args.includes('--fetch');
const plainMode = args.includes('--plain'); // Force plain text output

let html;

if (doFetch) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(10000),
  });
  html = await res.text();
} else {
  // Read HTML from stdin
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  html = Buffer.concat(chunks).toString();
}

if (!html || html.length < 50) {
  process.exit(1);
}

// Configure Turndown for LLM-optimized markdown
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
  emDelimiter: '*',
});

// Remove media elements (not useful for LLM text extraction)
turndown.addRule('removeMedia', {
  filter: ['img', 'iframe', 'video', 'audio', 'picture', 'svg'],
  replacement: () => '',
});

// Simplify links: keep text, drop URLs for cleaner output
turndown.addRule('simplifyLinks', {
  filter: 'a',
  replacement: (content) => content,
});

const doc = new JSDOM(html, { url });
const reader = new Readability(doc.window.document);
const article = reader.parse();

if (article && article.content && article.textContent && article.textContent.length >= 100) {
  console.log(article.title || '');

  if (plainMode) {
    // Plain text mode (backward compat)
    console.log(article.textContent.trim());
  } else {
    // Markdown mode — convert Readability's cleaned HTML to markdown
    const markdown = turndown.turndown(article.content);
    console.log(markdown);
  }
} else {
  // Fallback: extract text from body directly
  const body = doc.window.document.body;
  if (body) {
    // Remove script/style/nav/footer
    for (const el of body.querySelectorAll('script, style, nav, footer, header')) {
      el.remove();
    }
    const text = body.textContent.replace(/\s+/g, ' ').trim();
    console.log(''); // empty title
    console.log(text);
  }
  process.exit(0);
}
