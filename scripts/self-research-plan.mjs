#!/usr/bin/env node

import process from 'node:process';

const {
  createSelfResearchPlan,
  formatSelfResearchPlan,
  saveSelfResearchPlan,
} = await import('../dist/self-research-loop.js');

const args = process.argv.slice(2);
const opts = {};

const domain = readFlag('--domain');
const target = readFlag('--target');
if (domain) opts.domain = domain;
if (target) opts.target = target;

const run = createSelfResearchPlan('./memory', opts);

if (args.includes('--json')) {
  console.log(JSON.stringify(run, null, 2));
  process.exit(0);
}

if (!args.includes('--no-save')) {
  console.log(`saved: ${saveSelfResearchPlan('./memory', run)}`);
}

console.log(formatSelfResearchPlan(run));

function readFlag(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}
