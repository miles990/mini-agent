#!/usr/bin/env tsx
import { getMemoryRootDir } from '../src/memory-paths.js';
import { governGitStashes } from '../src/stash-governance.js';

const json = process.argv.includes('--json');
const apply = process.argv.includes('--apply');
const limit = Number.parseInt(readArg('--limit') ?? (apply ? '3' : '5'), 10);
const memoryDir = readArg('--memory-dir') ?? getMemoryRootDir();
const repoRoot = readArg('--repo-root') ?? process.cwd();

const result = await governGitStashes(memoryDir, repoRoot, {
  createTasks: apply,
  maxCases: Number.isFinite(limit) && limit > 0 ? limit : 3,
  record: apply,
  reason: apply ? 'stash-governance-apply' : 'stash-governance-scan',
});

if (json) {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} else {
  process.stdout.write(`[stash-governance] cases=${result.cases.length} createdTasks=${result.createdTasks.length}\n`);
  for (const diagnostic of result.cases) {
    process.stdout.write(`- ${diagnostic.decision}: ${diagnostic.stashRef} ${diagnostic.files.join(', ')}\n`);
    process.stdout.write(`  rootCause: ${diagnostic.rootCause}\n`);
    if (diagnostic.taskId) process.stdout.write(`  task: ${diagnostic.taskId}\n`);
  }
}

function readArg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  const prefix = `${name}=`;
  return argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
}
