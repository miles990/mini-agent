#!/usr/bin/env tsx
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const source = path.resolve(readArg('--source') ?? path.join(repoRoot, 'memory'));
const targetRoot = path.resolve(readArg('--target-root') ?? path.join(path.dirname(repoRoot), 'mini-agent-memory'));
const target = path.resolve(readArg('--target') ?? path.join(targetRoot, 'memory'));
const writeEnv = process.argv.includes('--write-env');
const force = process.argv.includes('--force');

if (!existsSync(source)) {
  fail(`source memory directory does not exist: ${source}`);
}

if (existsSync(target) && !force) {
  process.stdout.write(`[external-memory] target exists; leaving it unchanged: ${target}\n`);
} else {
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true, force: true, errorOnExist: false });
  process.stdout.write(`[external-memory] copied ${source} -> ${target}\n`);
}

mkdirSync(path.join(target, 'state'), { recursive: true });

const envLine = `MINI_AGENT_MEMORY_DIR=${target}`;
if (writeEnv) {
  const envPath = path.join(repoRoot, '.env');
  writeFileSync(envPath, `${envLine}\n`, { flag: 'a' });
  process.stdout.write(`[external-memory] appended to ${envPath}: ${envLine}\n`);
} else {
  process.stdout.write(`[external-memory] add to .env:\n${envLine}\n`);
}

process.stdout.write(JSON.stringify({
  source,
  target,
  env: { MINI_AGENT_MEMORY_DIR: target },
}, null, 2) + '\n');

function readArg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  const prefix = `${name}=`;
  return argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
}

function fail(message: string): never {
  process.stderr.write(`[external-memory] ${message}\n`);
  process.exit(1);
}

