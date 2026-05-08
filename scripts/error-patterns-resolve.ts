#!/usr/bin/env tsx

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getMemoryStateDir } from '../src/memory.js';

type ErrorPattern = {
  count: number;
  taskCreated: boolean;
  lastSeen: string;
  lastMessage?: string;
  resolved?: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
};

function usage(): never {
  process.stderr.write('usage: pnpm error-patterns:resolve <key> --commit <sha-or-url> [--at <iso>] [--json]\n');
  process.exit(2);
}

function parseArgs(argv: string[]): { key: string; commit: string; at: string; json: boolean } {
  const json = argv.includes('--json');
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--commit' || arg === '--at') {
      i += 1;
      continue;
    }
    if (!arg.startsWith('--')) positional.push(arg);
  }
  const key = positional[0];
  const commitIdx = argv.indexOf('--commit');
  const atIdx = argv.indexOf('--at');
  const commit = commitIdx >= 0 ? argv[commitIdx + 1] : '';
  const at = atIdx >= 0 ? argv[atIdx + 1] : new Date().toISOString();
  if (!key || !commit || !Number.isFinite(Date.parse(at))) usage();
  return { key, commit, at, json };
}

const { key, commit, at, json } = parseArgs(process.argv.slice(2));
const stateDir = getMemoryStateDir();
const statePath = path.join(stateDir, 'error-patterns.json');
const state: Record<string, ErrorPattern> = existsSync(statePath)
  ? JSON.parse(readFileSync(statePath, 'utf-8'))
  : {};

if (!state[key]) {
  process.stderr.write(`error-pattern not found: ${key}\n`);
  process.exit(1);
}

state[key] = {
  ...state[key],
  resolvedAt: at,
  resolvedBy: commit,
};

mkdirSync(stateDir, { recursive: true });
writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');

const result = { key, resolvedAt: at, resolvedBy: commit };
if (json) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
} else {
  process.stdout.write(`resolved ${key} at ${at} by ${commit}\n`);
}
