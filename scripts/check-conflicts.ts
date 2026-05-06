#!/usr/bin/env tsx
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { assessConflicts, mergeAppendOnlyText } from '../src/conflict-governance.js';

const args = new Set(process.argv.slice(2));
const shouldResolve = args.has('--resolve-append-only');
const json = args.has('--json');

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf-8' }).trimEnd();
}

function conflictedPaths(): string[] {
  const out = git(['diff', '--name-only', '--diff-filter=U']);
  return out ? out.split('\n').filter(Boolean) : [];
}

function stageContent(stage: 2 | 3, file: string): string {
  try {
    return execFileSync('git', ['show', `:${stage}:${file}`], { encoding: 'utf-8' });
  } catch {
    return '';
  }
}

function resolveAppendOnly(paths: string[]): string[] {
  const resolved: string[] = [];
  for (const file of paths) {
    const ours = stageContent(2, file);
    const theirs = stageContent(3, file);
    if (!ours && !theirs) continue;
    const merged = mergeAppendOnlyText(ours, theirs);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, merged, 'utf-8');
    execFileSync('git', ['add', file], { stdio: 'ignore' });
    resolved.push(file);
  }
  return resolved;
}

const paths = conflictedPaths();
let assessment = assessConflicts(paths);
let resolved: string[] = [];

if (shouldResolve && assessment.autoResolvable.length > 0) {
  resolved = resolveAppendOnly(assessment.autoResolvable.map(f => f.path));
  assessment = assessConflicts(conflictedPaths());
}

if (json) {
  console.log(JSON.stringify({ ...assessment, resolved }, null, 2));
} else {
  for (const line of assessment.guidance) console.error(`[conflict-governance] ${line}`);
  for (const file of assessment.conflicted) {
    console.error(`[conflict-governance] ${file.path}: ${file.resolution} (${file.reason})`);
  }
  if (resolved.length > 0) {
    console.error(`[conflict-governance] resolved append-only: ${resolved.join(', ')}`);
  }
}

if (assessment.shouldBlock) process.exit(1);
if (!existsSync('.git')) {
  // Kept only to make this script explicit about requiring a git worktree.
  process.exit(1);
}
