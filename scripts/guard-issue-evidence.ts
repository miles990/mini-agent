#!/usr/bin/env tsx
import { readFileSync } from 'node:fs';
import { evaluateIssueEvidenceGuard } from '../src/issue-evidence-guard.js';

const title = readArg('--title') ?? '';
const body = readArg('--body') ?? (readArg('--body-file') ? readFileSync(readArg('--body-file') as string, 'utf-8') : '');
const json = process.argv.includes('--json');

const result = evaluateIssueEvidenceGuard({ title, body });
if (json || !result.allowed) {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
} else {
  process.stdout.write('issue evidence guard: ok\n');
}

if (!result.allowed) process.exit(1);

function readArg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  const prefix = `${name}=`;
  return argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
}
