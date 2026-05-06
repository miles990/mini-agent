#!/usr/bin/env tsx
import { autocorrectRuntimeWorkspace } from '../src/runtime-workspace-autocorrect.js';

const apply = process.argv.includes('--apply');
const json = process.argv.includes('--json');
const repoArg = readArg('--repo');
const baseArg = readArg('--base');
const noPr = process.argv.includes('--no-pr');

const result = autocorrectRuntimeWorkspace(process.cwd(), {
  apply,
  repo: repoArg,
  baseBranch: baseArg,
  createPr: !noPr,
});

if (json) {
  process.stdout.write(JSON.stringify({ apply, result }, null, 2) + '\n');
} else {
  process.stdout.write(`[runtime-autocorrect] status=${result.status} reason=${result.reason}\n`);
  if (result.branch) process.stdout.write(`[runtime-autocorrect] branch=${result.branch}\n`);
  if (result.worktree) process.stdout.write(`[runtime-autocorrect] worktree=${result.worktree}\n`);
  if (result.prUrl) process.stdout.write(`[runtime-autocorrect] pr=${result.prUrl}\n`);
}

if (result.status === 'failed' || result.status === 'blocked') process.exit(1);

function readArg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  const prefix = `${name}=`;
  return argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
}
