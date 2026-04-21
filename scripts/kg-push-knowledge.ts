#!/usr/bin/env tsx
/**
 * KG Knowledge Push — batch ingest all mini-agent knowledge into external KG service.
 *
 * Parses CLAUDE.md sections, topics/*.md, SOUL.md, ARCHITECTURE.md into structured
 * triples and pushes to KG service (localhost:3300) via POST /api/write/triples.
 *
 * Usage:
 *   pnpm tsx scripts/kg-push-knowledge.ts [--dry-run] [--namespace kuro]
 *
 * Each knowledge chunk becomes:
 *   Subject: section/topic name (concept)
 *   Predicate: part_of
 *   Object: source category (project)
 *   Description: content (up to 2000 chars)
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const KG_SERVICE = 'http://localhost:3300';
const NAMESPACE = process.argv.includes('--namespace')
  ? process.argv[process.argv.indexOf('--namespace') + 1]
  : 'kuro';
const DRY_RUN = process.argv.includes('--dry-run');
const DESC_CAP = 2000;
const BATCH_SIZE = 20;

interface Triple {
  subject: string;
  subject_type: string;
  predicate: string;
  object: string;
  object_type: string;
  confidence: number;
  source_agent: string;
  description: string;
  namespace: string;
  properties?: Record<string, unknown>;
}

// ─── Parsers ───

function parseClaudeMdSections(filePath: string): Triple[] {
  const content = fs.readFileSync(filePath, 'utf-8');
  const triples: Triple[] = [];
  const lines = content.split('\n');
  let heading = '';
  let sectionLines: string[] = [];

  function flush() {
    if (!heading || sectionLines.length === 0) return;
    const text = sectionLines.join('\n').trim();
    if (text.length < 50) return; // skip tiny sections
    triples.push({
      subject: heading,
      subject_type: 'concept',
      predicate: 'part_of',
      object: 'mini-agent-docs',
      object_type: 'project',
      confidence: 0.9,
      source_agent: 'claude-code',
      description: text.slice(0, DESC_CAP),
      namespace: NAMESPACE,
      properties: {
        source_file: 'CLAUDE.md',
        char_count: text.length,
        section_type: 'documentation',
      },
    });
  }

  for (const line of lines) {
    const m = line.match(/^## (.+)/);
    if (m) {
      flush();
      heading = m[1].trim();
      sectionLines = [];
    } else {
      sectionLines.push(line);
    }
  }
  flush();
  return triples;
}

function parseMarkdownFile(filePath: string, category: string, objectName: string): Triple[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  if (content.length < 100) return [];

  const name = path.basename(filePath, '.md');
  const lines = content.split('\n');
  const title = lines[0]?.replace(/^#+\s*/, '').trim() || name;

  return [{
    subject: title,
    subject_type: category === 'identity' ? 'concept' : 'concept',
    predicate: 'part_of',
    object: objectName,
    object_type: 'project',
    confidence: 0.9,
    source_agent: 'claude-code',
    description: content.slice(0, DESC_CAP),
    namespace: NAMESPACE,
    properties: {
      source_file: path.relative(ROOT, filePath),
      char_count: content.length,
      section_type: category,
    },
  }];
}

function parseTopics(topicsDir: string): Triple[] {
  const triples: Triple[] = [];
  if (!fs.existsSync(topicsDir)) return triples;

  const files = fs.readdirSync(topicsDir).filter(f => f.endsWith('.md'));
  for (const file of files) {
    const filePath = path.join(topicsDir, file);
    const stat = fs.statSync(filePath);
    if (stat.size < 200) continue; // skip stubs

    const content = fs.readFileSync(filePath, 'utf-8');
    const topicName = file.replace('.md', '');
    const lines = content.split('\n');
    const title = lines[0]?.replace(/^#+\s*/, '').trim() || topicName;
    const entryCount = lines.filter(l => l.startsWith('- [')).length;

    triples.push({
      subject: title || topicName,
      subject_type: 'concept',
      predicate: 'part_of',
      object: 'kuro-topics',
      object_type: 'concept',
      confidence: 0.85,
      source_agent: 'claude-code',
      description: content.slice(0, DESC_CAP),
      namespace: NAMESPACE,
      properties: {
        source_file: `memory/topics/${file}`,
        topic_slug: topicName,
        char_count: content.length,
        entry_count: entryCount,
        section_type: 'topic',
      },
    });
  }
  return triples;
}

function parseSections(filePath: string, category: string, objectName: string): Triple[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const triples: Triple[] = [];
  const lines = content.split('\n');
  let heading = '';
  let sectionLines: string[] = [];

  function flush() {
    if (sectionLines.length === 0) return;
    const text = sectionLines.join('\n').trim();
    if (text.length < 50) return;
    const name = heading || path.basename(filePath, '.md');
    triples.push({
      subject: name,
      subject_type: 'concept',
      predicate: 'part_of',
      object: objectName,
      object_type: 'project',
      confidence: 0.85,
      source_agent: 'claude-code',
      description: text.slice(0, DESC_CAP),
      namespace: NAMESPACE,
      properties: {
        source_file: path.relative(ROOT, filePath),
        char_count: text.length,
        section_type: category,
      },
    });
  }

  for (const line of lines) {
    const m = line.match(/^## (.+)/);
    if (m) {
      flush();
      heading = m[1].trim();
      sectionLines = [];
    } else {
      sectionLines.push(line);
    }
  }
  flush();
  return triples;
}

// ─── Push to KG service ───

async function pushBatch(triples: Triple[], retries = 3): Promise<{ created: number; failed: number }> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const resp = await fetch(`${KG_SERVICE}/api/write/triples`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triples }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        console.error(`  ✗ Batch failed: ${resp.status} ${text.slice(0, 200)}`);
        return { created: 0, failed: triples.length };
      }
      const data = await resp.json() as { summary: { created: number; failed: number } };
      return data.summary;
    } catch (err) {
      if (attempt < retries - 1) {
        const delay = 1000 * (attempt + 1);
        process.stdout.write(` retry in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      } else {
        console.error(`  ✗ Batch failed after ${retries} attempts: ${(err as Error).message}`);
        return { created: 0, failed: triples.length };
      }
    }
  }
  return { created: 0, failed: triples.length };
}

// ─── Main ───

async function main() {
  console.log(`KG Knowledge Push — namespace: ${NAMESPACE}, dry-run: ${DRY_RUN}`);
  console.log('');

  // Check KG service health
  try {
    const resp = await fetch(`${KG_SERVICE}/health`);
    if (!resp.ok) throw new Error(`${resp.status}`);
    console.log('✓ KG service healthy');
  } catch (err) {
    console.error(`✗ KG service not reachable at ${KG_SERVICE}`);
    process.exit(1);
  }

  // Collect all triples
  const allTriples: Triple[] = [];

  // 1. CLAUDE.md sections
  const claudeTriples = parseClaudeMdSections(path.join(ROOT, 'CLAUDE.md'));
  console.log(`  CLAUDE.md: ${claudeTriples.length} sections`);
  allTriples.push(...claudeTriples);

  // 2. SOUL.md (as single entity + sections)
  const soulTriples = parseSections(path.join(ROOT, 'memory/SOUL.md'), 'identity', 'kuro-identity');
  console.log(`  SOUL.md: ${soulTriples.length} sections`);
  allTriples.push(...soulTriples);

  // 3. ARCHITECTURE.md sections
  const archTriples = parseSections(path.join(ROOT, 'memory/ARCHITECTURE.md'), 'architecture', 'mini-agent-architecture');
  console.log(`  ARCHITECTURE.md: ${archTriples.length} sections`);
  allTriples.push(...archTriples);

  // 4. MEMORY.md (as single entity)
  const memTriples = parseMarkdownFile(path.join(ROOT, 'memory/MEMORY.md'), 'memory', 'kuro-memory');
  console.log(`  MEMORY.md: ${memTriples.length} entities`);
  allTriples.push(...memTriples);

  // 5. Topics
  const topicTriples = parseTopics(path.join(ROOT, 'memory/topics'));
  console.log(`  topics/*.md: ${topicTriples.length} topics`);
  allTriples.push(...topicTriples);

  console.log(`\nTotal: ${allTriples.length} triples to push`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would push:');
    for (const t of allTriples.slice(0, 10)) {
      console.log(`  ${t.subject} --${t.predicate}--> ${t.object} (${t.description.length} chars)`);
    }
    if (allTriples.length > 10) console.log(`  ... and ${allTriples.length - 10} more`);
    return;
  }

  // Push in batches
  let totalCreated = 0;
  let totalFailed = 0;
  for (let i = 0; i < allTriples.length; i += BATCH_SIZE) {
    const batch = allTriples.slice(i, i + BATCH_SIZE);
    process.stdout.write(`  Pushing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(allTriples.length / BATCH_SIZE)}...`);
    const { created, failed } = await pushBatch(batch);
    totalCreated += created;
    totalFailed += failed;
    console.log(` ${created} created, ${failed} failed`);
  }

  console.log(`\n✓ Done: ${totalCreated} created, ${totalFailed} failed`);

  // Show updated stats
  try {
    const resp = await fetch(`${KG_SERVICE}/api/stats`);
    const stats = await resp.json() as Record<string, unknown>;
    console.log(`  KG total: ${stats.nodes} nodes, ${stats.edges} edges`);
  } catch { /* ignore */ }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
