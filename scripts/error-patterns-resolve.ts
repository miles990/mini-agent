#!/usr/bin/env tsx

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getMemoryStateDir } from '../src/memory.js';

type MitigationKind = 'circuit_breaker' | 'retry' | 'fallback' | 'expected_steady_state';

type ErrorPattern = {
  count: number;
  taskCreated: boolean;
  lastSeen: string;
  lastMessage?: string;
  resolved?: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
  mitigationKind?: MitigationKind;
};

const VALID_MITIGATIONS: ReadonlySet<MitigationKind> = new Set([
  'circuit_breaker', 'retry', 'fallback', 'expected_steady_state',
]);

function usage(): never {
  process.stderr.write(
    'usage: pnpm error-patterns:resolve <key> --commit <sha-or-url> [--at <iso>] ' +
    '[--mitigation <circuit_breaker|retry|fallback|expected_steady_state>] [--json]\n'
  );
  process.exit(2);
}

function parseArgs(argv: string[]): {
  key: string; commit: string; at: string; mitigation?: MitigationKind; json: boolean;
} {
  const json = argv.includes('--json');
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--commit' || arg === '--at' || arg === '--mitigation') {
      i += 1;
      continue;
    }
    if (!arg.startsWith('--')) positional.push(arg);
  }
  const key = positional[0];
  const commitIdx = argv.indexOf('--commit');
  const atIdx = argv.indexOf('--at');
  const mitIdx = argv.indexOf('--mitigation');
  const commit = commitIdx >= 0 ? argv[commitIdx + 1] : '';
  const at = atIdx >= 0 ? argv[atIdx + 1] : new Date().toISOString();
  const mitigationRaw = mitIdx >= 0 ? argv[mitIdx + 1] : undefined;
  if (mitigationRaw && !VALID_MITIGATIONS.has(mitigationRaw as MitigationKind)) {
    process.stderr.write(`invalid --mitigation: ${mitigationRaw}\n`);
    usage();
  }
  if (!key || !commit || !Number.isFinite(Date.parse(at))) usage();
  return { key, commit, at, mitigation: mitigationRaw as MitigationKind | undefined, json };
}

const { key, commit, at, mitigation, json } = parseArgs(process.argv.slice(2));
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
  ...(mitigation ? { mitigationKind: mitigation } : {}),
};

mkdirSync(stateDir, { recursive: true });
writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');

const result = { key, resolvedAt: at, resolvedBy: commit, ...(mitigation ? { mitigationKind: mitigation } : {}) };
if (json) {
  process.stdout.write(`${JSON.stringify(result)}\n`);
} else {
  process.stdout.write(`resolved ${key} at ${at} by ${commit}${mitigation ? ` (mitigation=${mitigation})` : ''}\n`);
}
