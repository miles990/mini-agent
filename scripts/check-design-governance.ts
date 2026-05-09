#!/usr/bin/env tsx
import { getMemoryRootDir } from '../src/memory-paths.js';
import { evaluateDesignGovernance } from '../src/design-governance.js';
import { queryMemoryIndexSync } from '../src/memory-index.js';

const args = new Set(process.argv.slice(2));
const memoryDir = getMemoryRootDir();
const openTasks = queryMemoryIndexSync(memoryDir, {
  type: ['task'],
  status: ['pending', 'in_progress', 'needs-decomposition', 'blocked', 'hold'],
});
const report = evaluateDesignGovernance(memoryDir, openTasks);

if (args.has('--json')) {
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
} else {
  process.stdout.write(`design governance: ${report.status} — ${report.summary}\n`);
  for (const line of report.evidence) process.stdout.write(`- ${line}\n`);
}

if (report.status === 'blocked') process.exit(1);
