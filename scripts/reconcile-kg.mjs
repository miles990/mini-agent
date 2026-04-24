#!/usr/bin/env node
/**
 * reconcile-kg.mjs — scan memory/ markdown files, compare to KG nodes, produce drift report.
 *
 * C1 of Context Engine plan. Implements `reconcileKGFromFiles()` convergence condition:
 *   "執行後產 drift report：files-only, kg-only, divergent 三類"
 *
 * Usage:
 *   node scripts/reconcile-kg.mjs                    # print report to stdout
 *   node scripts/reconcile-kg.mjs --out <path>       # write JSON report
 *   node scripts/reconcile-kg.mjs --markdown <path>  # write markdown report
 *   node scripts/reconcile-kg.mjs --namespace mini-agent,shared  # filter KG namespaces
 *
 * Method:
 *   1. Extract top-level entity names from markdown files (H1/H2 headings + topic filename).
 *   2. Fetch KG nodes in target namespaces.
 *   3. Bucket:
 *      - files-only: markdown has a heading matching no KG node.
 *      - kg-only:    KG node with no markdown mention.
 *      - divergent:  both exist but heading text and node description differ beyond threshold.
 *
 * Non-goals:
 *   - Does not write/fix drift. Report only.
 *   - Not a semantic comparison; name-based matching is intentional (cheap, deterministic).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const MEMORY_ROOT = path.join(PROJECT_ROOT, 'memory');
const KG_BASE = process.env.KG_BASE_URL || 'http://localhost:3300';

function parseArgs() {
  const args = { out: null, markdown: null, namespaces: ['mini-agent', 'shared', 'kuro'] };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--out') args.out = process.argv[++i];
    else if (a === '--markdown') args.markdown = process.argv[++i];
    else if (a === '--namespace') args.namespaces = process.argv[++i].split(',');
  }
  return args;
}

function normalize(s) {
  return s.toLowerCase().replace(/[\s\-_]+/g, ' ').trim();
}

async function readMarkdownEntities() {
  const entities = []; // { name, source, kind }

  // Topics: filename-based entity names (primary)
  const topicsDir = path.join(MEMORY_ROOT, 'topics');
  try {
    const topicFiles = await fs.readdir(topicsDir);
    for (const f of topicFiles) {
      if (!f.endsWith('.md')) continue;
      const name = f.replace(/\.md$/, '');
      entities.push({ name, source: `topics/${f}`, kind: 'topic' });

      // Extract H1/H2 inside
      try {
        const content = await fs.readFile(path.join(topicsDir, f), 'utf8');
        const headings = content.match(/^#{1,2}\s+(.+)$/gm) || [];
        for (const h of headings.slice(0, 5)) {
          const title = h.replace(/^#{1,2}\s+/, '').trim();
          if (title && title.length < 80) {
            entities.push({ name: title, source: `topics/${f}`, kind: 'heading' });
          }
        }
      } catch { /* unreadable — skip */ }
    }
  } catch { /* dir missing — skip */ }

  // MEMORY.md sections
  try {
    const memPath = path.join(MEMORY_ROOT, 'MEMORY.md');
    const content = await fs.readFile(memPath, 'utf8');
    const sections = content.match(/^##\s+(.+)$/gm) || [];
    for (const s of sections) {
      const title = s.replace(/^##\s+/, '').trim();
      if (title.length < 80) {
        entities.push({ name: title, source: 'MEMORY.md', kind: 'section' });
      }
    }
  } catch { /* missing — skip */ }

  // Discussions: filename-based
  const discussionsDir = path.join(MEMORY_ROOT, 'discussions');
  try {
    const files = await fs.readdir(discussionsDir);
    for (const f of files) {
      if (!f.endsWith('.md')) continue;
      const name = f.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
      entities.push({ name, source: `discussions/${f}`, kind: 'discussion' });
    }
  } catch { /* missing — skip */ }

  return entities;
}

async function fetchKGNodes(namespaces) {
  const nodes = []; // { id, name, type, namespace, description }
  for (const ns of namespaces) {
    try {
      const res = await fetch(`${KG_BASE}/api/nodes?namespace=${encodeURIComponent(ns)}&limit=2000`);
      if (!res.ok) continue;
      const data = await res.json();
      const list = Array.isArray(data) ? data : (data.nodes || []);
      for (const n of list) {
        nodes.push({
          id: n.id, name: n.name || '', type: n.type || '',
          namespace: n.namespace || ns,
          description: n.description || '',
        });
      }
    } catch { /* KG unreachable — treat as empty */ }
  }
  return nodes;
}

function bucketEntities(markdownEntities, kgNodes) {
  const fileIndex = new Map(); // normalized name → [entities]
  for (const e of markdownEntities) {
    const key = normalize(e.name);
    if (!key) continue;
    if (!fileIndex.has(key)) fileIndex.set(key, []);
    fileIndex.get(key).push(e);
  }

  const kgIndex = new Map();
  for (const n of kgNodes) {
    const key = normalize(n.name);
    if (!key) continue;
    if (!kgIndex.has(key)) kgIndex.set(key, []);
    kgIndex.get(key).push(n);
  }

  const filesOnly = [];
  const kgOnly = [];
  const divergent = [];

  for (const [key, entries] of fileIndex.entries()) {
    if (!kgIndex.has(key)) {
      filesOnly.push({ name: entries[0].name, source: entries[0].source, kind: entries[0].kind });
    } else {
      const kgEntries = kgIndex.get(key);
      // Check name casing/word-order mismatch as divergence signal.
      const markdownCanonical = entries[0].name.trim();
      const kgCanonical = kgEntries[0].name.trim();
      if (markdownCanonical !== kgCanonical) {
        divergent.push({
          name_in_files: markdownCanonical,
          name_in_kg: kgCanonical,
          source: entries[0].source,
          kg_id: kgEntries[0].id,
          reason: 'name-canonicalization',
        });
      }
    }
  }

  for (const [key, entries] of kgIndex.entries()) {
    if (!fileIndex.has(key)) {
      const n = entries[0];
      kgOnly.push({ id: n.id, name: n.name, type: n.type, namespace: n.namespace });
    }
  }

  return { filesOnly, kgOnly, divergent };
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# KG Reconciliation Drift Report');
  lines.push('');
  lines.push(`- Generated: ${report.generated_at}`);
  lines.push(`- Namespaces scanned: ${report.namespaces.join(', ')}`);
  lines.push(`- Markdown entities: ${report.totals.markdown}`);
  lines.push(`- KG nodes: ${report.totals.kg}`);
  lines.push('');
  lines.push(`## Summary`);
  lines.push('');
  lines.push(`| Bucket | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| files-only | ${report.files_only.length} |`);
  lines.push(`| kg-only | ${report.kg_only.length} |`);
  lines.push(`| divergent | ${report.divergent.length} |`);
  lines.push('');

  lines.push('## files-only (in markdown, absent from KG)');
  lines.push('');
  if (report.files_only.length === 0) {
    lines.push('_(none)_');
  } else {
    for (const e of report.files_only.slice(0, 50)) {
      lines.push(`- **${e.name}** (${e.kind}) — ${e.source}`);
    }
    if (report.files_only.length > 50) lines.push(`- _(…+${report.files_only.length - 50} more)_`);
  }
  lines.push('');

  lines.push('## kg-only (in KG, absent from markdown)');
  lines.push('');
  if (report.kg_only.length === 0) {
    lines.push('_(none)_');
  } else {
    for (const e of report.kg_only.slice(0, 50)) {
      lines.push(`- **${e.name}** (${e.type}, ${e.namespace}) — id: \`${e.id.slice(0, 8)}\``);
    }
    if (report.kg_only.length > 50) lines.push(`- _(…+${report.kg_only.length - 50} more)_`);
  }
  lines.push('');

  lines.push('## divergent (name mismatch between sources)');
  lines.push('');
  if (report.divergent.length === 0) {
    lines.push('_(none)_');
  } else {
    for (const e of report.divergent) {
      lines.push(`- **${e.name_in_files}** ↔ **${e.name_in_kg}** — ${e.source} (kg: \`${e.kg_id.slice(0, 8)}\`)`);
    }
  }
  lines.push('');

  return lines.join('\n');
}

async function main() {
  const args = parseArgs();
  const [markdownEntities, kgNodes] = await Promise.all([
    readMarkdownEntities(),
    fetchKGNodes(args.namespaces),
  ]);

  const buckets = bucketEntities(markdownEntities, kgNodes);
  const driftRate = kgNodes.length === 0 ? 0 :
    (buckets.filesOnly.length + buckets.kgOnly.length + buckets.divergent.length) /
    Math.max(markdownEntities.length, kgNodes.length);

  const report = {
    generated_at: new Date().toISOString(),
    namespaces: args.namespaces,
    totals: {
      markdown: markdownEntities.length,
      kg: kgNodes.length,
    },
    drift_rate: Number(driftRate.toFixed(3)),
    files_only: buckets.filesOnly,
    kg_only: buckets.kgOnly,
    divergent: buckets.divergent,
  };

  if (args.out) {
    await fs.writeFile(args.out, JSON.stringify(report, null, 2));
    console.error(`JSON report written to ${args.out}`);
  }
  if (args.markdown) {
    await fs.writeFile(args.markdown, renderMarkdown(report));
    console.error(`Markdown report written to ${args.markdown}`);
  }

  // Always print summary
  console.log(`files-only: ${report.files_only.length}  kg-only: ${report.kg_only.length}  divergent: ${report.divergent.length}  drift_rate: ${report.drift_rate}`);

  if (!args.out && !args.markdown) {
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
