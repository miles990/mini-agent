#!/usr/bin/env node
/**
 * Kuro Portfolio Build Script
 *
 * Scans content/journal/*.md files, extracts frontmatter,
 * and generates manifest.json automatically.
 *
 * Usage: node kuro-portfolio/build.mjs
 *
 * Workflow for Kuro:
 *   1. Write a .md file in content/journal/
 *   2. Run: node kuro-portfolio/build.mjs
 *   3. git add && git commit && git push
 */

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, basename } from 'node:path';

const PORTFOLIO_DIR = new URL('.', import.meta.url).pathname;
const JOURNAL_DIR = join(PORTFOLIO_DIR, 'content', 'journal');
const MANIFEST_PATH = join(JOURNAL_DIR, 'manifest.json');

/**
 * Parse simple YAML frontmatter from markdown.
 * Supports:
 *   ---
 *   title: My Title
 *   date: 2026-02-10
 *   summary: A short description.
 *   tags: tag1, tag2
 *   ---
 *
 * If no frontmatter, extracts title from first # heading
 * and date from filename (YYYY-MM-DD-slug.md).
 */
function parseFrontmatter(content, filename) {
  const meta = {};

  // Try frontmatter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    for (const line of fmMatch[1].split('\n')) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        const key = line.slice(0, colonIdx).trim();
        const val = line.slice(colonIdx + 1).trim();
        meta[key] = val;
      }
    }
  }

  // Fallback: title from first heading
  if (!meta.title) {
    const h1 = content.match(/^#\s+(.+)$/m);
    if (h1) meta.title = h1[1].trim();
  }

  // Fallback: date from filename
  if (!meta.date) {
    const dateMatch = filename.match(/^(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) meta.date = dateMatch[1];
  }

  // Fallback: summary from first paragraph
  if (!meta.summary) {
    const bodyStart = fmMatch ? content.slice(fmMatch[0].length) : content;
    const firstPara = bodyStart.match(/\n\n([^#\n][^\n]+)/);
    if (firstPara) {
      meta.summary = firstPara[1].replace(/\*+/g, '').trim().slice(0, 200);
    }
  }

  // Parse tags
  if (meta.tags && typeof meta.tags === 'string') {
    meta.tags = meta.tags.split(',').map(t => t.trim()).filter(Boolean);
  }

  // Slug from filename
  meta.slug = basename(filename, '.md');

  return meta;
}

async function build() {
  console.log('Scanning', JOURNAL_DIR);

  let files;
  try {
    files = (await readdir(JOURNAL_DIR)).filter(f => f.endsWith('.md') && !f.match(/\.\w{2}\.md$/));
  } catch (err) {
    console.error('Cannot read journal directory:', err.message);
    process.exit(1);
  }

  // Load existing manifest to preserve i18n data
  let existingBySlug = {};
  try {
    const existing = JSON.parse(await readFile(MANIFEST_PATH, 'utf-8'));
    for (const e of existing) {
      if (e.slug) existingBySlug[e.slug] = e;
    }
  } catch { /* no existing manifest, fine */ }

  const entries = [];

  for (const file of files) {
    const content = await readFile(join(JOURNAL_DIR, file), 'utf-8');
    const meta = parseFrontmatter(content, file);

    if (!meta.title) {
      console.warn(`  SKIP ${file} — no title found`);
      continue;
    }

    const entry = {
      slug: meta.slug,
      title: meta.title,
      date: meta.date || 'undated',
      summary: meta.summary || '',
    };
    if (meta.order) entry.order = parseInt(meta.order, 10);
    if (meta.tags) entry.tags = meta.tags;

    // Preserve i18n from existing manifest
    const prev = existingBySlug[meta.slug];
    if (prev?.i18n) entry.i18n = prev.i18n;

    entries.push(entry);
    console.log(`  + ${meta.title} (${meta.date || 'no date'})`);
  }

  // Sort newest first; same date: order descending (higher = newer), then slug descending
  entries.sort((a, b) => b.date.localeCompare(a.date) || (b.order || 0) - (a.order || 0) || b.slug.localeCompare(a.slug));

  await writeFile(MANIFEST_PATH, JSON.stringify(entries, null, 2) + '\n');
  console.log(`\nWrote ${entries.length} entries to manifest.json`);
}

build().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
