#!/usr/bin/env tsx
import { initFeatures } from '../src/features.js';
import { getMemoryRootDir } from '../src/memory-paths.js';
import { applySafeSystemTruth, evaluateSystemTruth, formatSystemTruth } from '../src/system-truth.js';

const args = new Set(process.argv.slice(2));
const json = args.has('--json');
const applySafe = args.has('--apply-safe');
const noKgPushSample = args.has('--no-kg-push-sample');

initFeatures();

const options = {
  memoryDir: getMemoryRootDir(),
  repoRoot: process.cwd(),
  kgPushSample: !noKgPushSample,
};

if (applySafe) {
  const result = await applySafeSystemTruth(options);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatSystemTruth(result.after));
    console.log('');
    console.log(`apply-safe: applied=${result.applied.length} skipped=${result.skipped.length}`);
    for (const action of result.applied) console.log(`- ${action.action} ${action.commitmentId}: ${action.reason}`);
    for (const skipped of result.skipped) console.log(`- skipped ${skipped}`);
  }
  if (result.after.status === 'blocked') process.exit(1);
  process.exit(0);
}

const snapshot = await evaluateSystemTruth(options);

if (json) {
  console.log(JSON.stringify(snapshot, null, 2));
} else {
  console.log(formatSystemTruth(snapshot));
}

if (snapshot.status === 'blocked') process.exit(1);
