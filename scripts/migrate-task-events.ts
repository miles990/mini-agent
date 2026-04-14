#!/usr/bin/env tsx
/**
 * Memory Layer v3 — Phase 3 Event Split
 *
 * Split task entries out of `memory/index/relations.jsonl` into
 * `memory/state/task-events.jsonl`, leaving relations.jsonl with
 * commitment/goal/remember/… only.
 *
 * Both files are compiled views (gitignored) — safe to regenerate. The
 * truth layer (entries.jsonl + raw tag stream) is untouched.
 *
 * Idempotent:
 *   - If task-events.jsonl already exists and looks migrated (all lines
 *     type=task), skip without rewriting relations.jsonl.
 *   - If relations.jsonl still contains tasks, split them out.
 *
 * Usage:
 *   tsx scripts/migrate-task-events.ts [memoryDir] [--dry-run]
 *
 * Defaults to `./memory` relative to CWD.
 */

import fs from 'node:fs';
import path from 'node:path';

interface Row {
  id?: string;
  type?: string;
  [k: string]: unknown;
}

function readJsonl(filePath: string): { lines: string[]; parsed: Row[] } {
  if (!fs.existsSync(filePath)) return { lines: [], parsed: [] };
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines: string[] = [];
  const parsed: Row[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    lines.push(line);
    try {
      parsed.push(JSON.parse(line) as Row);
    } catch {
      // keep line for diagnostics, drop from parsed
    }
  }
  return { lines, parsed };
}

function parseArgs(argv: string[]): { memoryDir: string; dryRun: boolean } {
  const rest = argv.slice(2);
  const dryRun = rest.includes('--dry-run');
  const positional = rest.filter(a => !a.startsWith('--'));
  const memoryDir = path.resolve(positional[0] ?? './memory');
  return { memoryDir, dryRun };
}

function main(): void {
  const { memoryDir, dryRun } = parseArgs(process.argv);
  if (!fs.existsSync(memoryDir)) {
    console.error(`memory dir not found: ${memoryDir}`);
    process.exit(1);
  }

  const relPath = path.join(memoryDir, 'index', 'relations.jsonl');
  const taskEventsPath = path.join(memoryDir, 'state', 'task-events.jsonl');

  const rel = readJsonl(relPath);
  const existing = readJsonl(taskEventsPath);

  const relTasks = rel.parsed
    .map((p, i) => ({ row: p, line: rel.lines[i] }))
    .filter(x => x.row.type === 'task');
  const relNonTasks = rel.parsed
    .map((p, i) => ({ row: p, line: rel.lines[i] }))
    .filter(x => x.row.type !== 'task');

  // Deduplicate by line content against existing task-events.jsonl (by raw
  // line — migration is idempotent at the line level).
  const existingLines = new Set(existing.lines);
  const newTaskLines = relTasks.map(x => x.line).filter(l => !existingLines.has(l));

  const typeCounts: Record<string, number> = {};
  for (const r of rel.parsed) {
    const t = r.type ?? '(unknown)';
    typeCounts[t] = (typeCounts[t] ?? 0) + 1;
  }

  const tag = dryRun ? '[migrate:dry-run]' : '[migrate]';
  console.log(`${tag} memoryDir=${memoryDir}`);
  console.log(`${tag} relations.jsonl: ${rel.lines.length} lines`);
  for (const [t, n] of Object.entries(typeCounts)) {
    console.log(`  - type=${t}: ${n}`);
  }
  console.log(`${tag} task-events.jsonl: ${existing.lines.length} lines (pre-existing)`);
  console.log(`${tag} would move ${relTasks.length} task rows → task-events.jsonl`);
  console.log(`${tag}   ${newTaskLines.length} new (dedup: ${relTasks.length - newTaskLines.length} already present)`);
  console.log(`${tag} relations.jsonl after: ${relNonTasks.length} non-task rows`);

  if (dryRun) {
    const preview = relTasks.slice(0, 3);
    if (preview.length > 0) {
      console.log(`${tag} first ${preview.length} task rows that would move:`);
      for (const p of preview) {
        const row = p.row as { id?: string; status?: string; summary?: string };
        const summary = (row.summary ?? '').slice(0, 80);
        console.log(`  - ${row.id} [${row.status}] ${summary}`);
      }
    }
    console.log(`${tag} no writes performed. rerun without --dry-run to commit.`);
    return;
  }

  // Write task-events.jsonl (append new task lines)
  fs.mkdirSync(path.dirname(taskEventsPath), { recursive: true });
  if (newTaskLines.length > 0) {
    fs.appendFileSync(taskEventsPath, newTaskLines.join('\n') + '\n', 'utf8');
  } else if (!fs.existsSync(taskEventsPath)) {
    fs.writeFileSync(taskEventsPath, '', 'utf8');
  }

  // Rewrite relations.jsonl with non-task rows only
  const nonTaskLines = relNonTasks.map(x => x.line);
  fs.writeFileSync(relPath, nonTaskLines.length > 0 ? nonTaskLines.join('\n') + '\n' : '', 'utf8');

  const afterRel = readJsonl(relPath);
  const afterTE = readJsonl(taskEventsPath);
  console.log(`${tag} done.`);
  console.log(`${tag} relations.jsonl: ${afterRel.lines.length} lines`);
  console.log(`${tag} task-events.jsonl: ${afterTE.lines.length} lines`);
}

main();
