#!/usr/bin/env tsx
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { assessConflicts, mergeAppendOnlyText } from '../src/conflict-governance.js';

const args = new Set(process.argv.slice(2));
const shouldResolve = args.has('--resolve-append-only');
const json = args.has('--json');

function git(args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf-8' }).trimEnd();
}

function assertGitWorktree(): void {
  try {
    const inside = execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trimEnd();
    if (inside === 'true') return;
  } catch {
    // Fall through to the explicit error below.
  }

  const message = 'check-conflicts must run inside a git worktree';
  if (json) {
    console.log(JSON.stringify({ error: message }, null, 2));
  } else {
    console.error(`[conflict-governance] ${message}.`);
  }
  process.exit(1);
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

assertGitWorktree();

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
