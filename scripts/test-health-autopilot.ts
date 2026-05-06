#!/usr/bin/env tsx
import { spawnSync } from 'node:child_process';
import { getMemoryRootDir } from '../src/memory-paths.js';
import { ensureAutonomyClosureTask, evaluateAutonomyClosure } from '../src/autonomy-closure-health.js';
import { buildTestHealthSnapshot, summarizeTestHealth, writeTestHealthSnapshot } from '../src/test-health-autopilot.js';

const argv = process.argv.slice(2);
const json = argv.includes('--json');
const ensure = argv.includes('--ensure');
const separator = argv.indexOf('--');
const command = separator >= 0 ? argv.slice(separator + 1) : ['pnpm', 'exec', 'vitest', 'run'];
while (command[0] === '--') command.shift();

if (command.length === 0) {
  process.stderr.write('usage: pnpm check:test-health [--json] [--ensure] [-- command ...]\n');
  process.exit(2);
}

const result = spawnSync(command[0], command.slice(1), {
  cwd: process.cwd(),
  encoding: 'utf-8',
  stdio: ['ignore', 'pipe', 'pipe'],
});
const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
const exitCode = result.status ?? 1;
const memoryDir = getMemoryRootDir();
const snapshot = buildTestHealthSnapshot(command.join(' '), exitCode, output);
writeTestHealthSnapshot(memoryDir, snapshot);

const closure = evaluateAutonomyClosure(memoryDir);
const task = ensure ? await ensureAutonomyClosureTask(memoryDir, closure) : null;

if (json) {
  console.log(JSON.stringify({ snapshot, closure, task }, null, 2));
} else {
  process.stdout.write(output);
  console.log(`[test-health] ${summarizeTestHealth(snapshot)}`);
  if (task) console.log(`[test-health] queued repair task: ${task.id} ${task.summary ?? ''}`);
}

process.exit(exitCode);
