#!/usr/bin/env npx tsx
/**
 * Replay historical REMEMBER entries through classifyRemember()
 * Usage: npx tsx scripts/replay-classifier.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { classifyRemember } from '../src/dispatcher.js';

const TOPICS_DIR = path.join(import.meta.dirname, '..', 'memory', 'topics');
const MEMORY_FILE = path.join(import.meta.dirname, '..', 'memory', 'MEMORY.md');

interface Entry {
  file: string;
  topic: string | undefined;
  content: string;
  category: string;
}

function extractEntries(filePath: string, topic: string | undefined): Entry[] {
  const text = fs.readFileSync(filePath, 'utf-8');
  const entries: Entry[] = [];

  for (const line of text.split('\n')) {
    // Match bullet entries: "- content" or "- [date] content"
    const match = line.match(/^- (.+)/);
    if (!match) continue;

    let content = match[1].trim();
    // Strip date prefix if present: "[2026-02-05]" or "[YYYY-MM-DD]"
    content = content.replace(/^\[\d{4}-\d{2}-\d{2}\]\s*/, '');

    // Skip very short entries or section markers
    if (content.length < 10) continue;

    const category = classifyRemember(content, topic);
    entries.push({ file: path.basename(filePath), topic, content, category });
  }
  return entries;
}

// Collect all entries
const allEntries: Entry[] = [];

// 1. Topics files
if (fs.existsSync(TOPICS_DIR)) {
  for (const f of fs.readdirSync(TOPICS_DIR).filter(f => f.endsWith('.md'))) {
    const topic = f.replace('.md', '');
    allEntries.push(...extractEntries(path.join(TOPICS_DIR, f), topic));
  }
}

// 2. MEMORY.md
if (fs.existsSync(MEMORY_FILE)) {
  allEntries.push(...extractEntries(MEMORY_FILE, undefined));
}

// Summary
const counts: Record<string, number> = {};
for (const e of allEntries) {
  counts[e.category] = (counts[e.category] || 0) + 1;
}

console.log(`\n=== Classification Summary (${allEntries.length} entries) ===\n`);
for (const [cat, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cat}: ${count} (${((count / allEntries.length) * 100).toFixed(1)}%)`);
}

// Per-topic breakdown
const topicCounts: Record<string, Record<string, number>> = {};
for (const e of allEntries) {
  const key = e.file;
  if (!topicCounts[key]) topicCounts[key] = {};
  topicCounts[key][e.category] = (topicCounts[key][e.category] || 0) + 1;
}

console.log(`\n=== Per-File Breakdown ===\n`);
for (const [file, cats] of Object.entries(topicCounts).sort()) {
  const total = Object.values(cats).reduce((a, b) => a + b, 0);
  const breakdown = Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}:${n}`).join(', ');
  console.log(`  ${file} (${total}): ${breakdown}`);
}

// Show samples of each category
console.log(`\n=== Samples by Category ===\n`);
for (const cat of Object.keys(counts).sort()) {
  const samples = allEntries.filter(e => e.category === cat).slice(0, 3);
  console.log(`[${cat}]`);
  for (const s of samples) {
    console.log(`  - (${s.file}) ${s.content.slice(0, 80)}...`);
  }
  console.log('');
}
