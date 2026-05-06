#!/usr/bin/env tsx
import { getMemoryRootDir } from '../src/memory-paths.js';
import { ensureAutonomyClosureTask, evaluateAutonomyClosure } from '../src/autonomy-closure-health.js';

const args = new Set(process.argv.slice(2));
const json = args.has('--json');
const ensure = args.has('--ensure');
const memoryDir = getMemoryRootDir();

const snapshot = evaluateAutonomyClosure(memoryDir);
const task = ensure ? await ensureAutonomyClosureTask(memoryDir, snapshot) : null;
const payload = { ...snapshot, task };

if (json) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log(`autonomy closure: ${snapshot.status} score=${snapshot.score}`);
  for (const stage of snapshot.stages) {
    console.log(`- ${stage.status.padEnd(7)} ${stage.stage}: ${stage.summary}`);
  }
  if (task) console.log(`queued task: ${task.id} ${task.summary ?? ''}`);
}

if (snapshot.status === 'blocked') process.exit(1);
