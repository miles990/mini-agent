#!/usr/bin/env tsx
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import {
  buildMemoryRepoHealthReport,
  formatMemoryRepoHealthMarkdown,
  MEMORY_REPO_GITIGNORE,
  MEMORY_REPO_MAINTENANCE,
  MEMORY_REPO_README,
  CONTEXT_FABRIC_DESIGN,
} from '../src/memory-repo-policy.js';

const repoRoot = process.cwd();
const memoryDir = path.resolve(
  readArg('--memory-dir')
    ?? process.env.MINI_AGENT_MEMORY_DIR
    ?? path.join(path.dirname(repoRoot), 'mini-agent-memory', 'memory'),
);
const init = process.argv.includes('--init');
const commit = process.argv.includes('--commit');
const check = process.argv.includes('--check');
const force = process.argv.includes('--force');
const remote = readArg('--remote');

if (!existsSync(memoryDir)) fail(`memory dir does not exist: ${memoryDir}`);
if (path.basename(memoryDir) !== 'memory') {
  fail(`memory dir should point at the memory/ directory, got: ${memoryDir}`);
}

if (init && !existsSync(path.join(memoryDir, '.git'))) {
  git(['init', '-b', 'main'], memoryDir);
}

writePolicyFile('.gitignore', MEMORY_REPO_GITIGNORE);
writePolicyFile('README.md', MEMORY_REPO_README);
writePolicyFile('MAINTENANCE.md', MEMORY_REPO_MAINTENANCE);
mkdirSync(path.join(memoryDir, 'docs'), { recursive: true });
writePolicyFile('docs/context-fabric.md', CONTEXT_FABRIC_DESIGN);

if (remote) {
  ensureRemote(remote);
}

const report = buildMemoryRepoHealthReport(memoryDir, collectFiles(memoryDir));
mkdirSync(path.join(memoryDir, 'reports'), { recursive: true });
writeFileSync(path.join(memoryDir, 'reports', 'memory-repo-health.md'), formatMemoryRepoHealthMarkdown(report));
mkdirSync(path.join(memoryDir, 'state'), { recursive: true });
writeFileSync(path.join(memoryDir, 'state', 'memory-repo-health.json'), JSON.stringify(report, null, 2) + '\n');

const status = existsSync(path.join(memoryDir, '.git')) ? git(['status', '--short'], memoryDir) : '';
if (commit) {
  if (!existsSync(path.join(memoryDir, '.git'))) fail('use --init before --commit');
  git(['add', '.gitignore', 'README.md', 'MAINTENANCE.md', 'docs/context-fabric.md', 'reports/memory-repo-health.md'], memoryDir);
  const staged = git(['diff', '--cached', '--quiet'], memoryDir, { allowFailure: true });
  if (staged.exitCode !== 0) {
    git(['commit', '-m', 'chore: initialize memory repo policy'], memoryDir);
  }
}

const payload = {
  memoryDir,
  gitRepo: existsSync(path.join(memoryDir, '.git')),
  remote: readRemote(),
  status: status.trim().split('\n').filter(Boolean).slice(0, 30),
  report: {
    totals: report.totals,
    classes: report.classes,
    kgCandidates: report.kgCandidates.length,
    healthReport: path.join(memoryDir, 'reports', 'memory-repo-health.md'),
  },
};

process.stdout.write(JSON.stringify(payload, null, 2) + '\n');

if (check) {
  const problems: string[] = [];
  if (!existsSync(path.join(memoryDir, '.git'))) problems.push('memory dir is not a git repository; run with --init');
  if (!existsSync(path.join(memoryDir, '.gitignore'))) problems.push('missing .gitignore policy');
  if (!existsSync(path.join(memoryDir, 'reports', 'memory-repo-health.md'))) problems.push('missing health report');
  if (problems.length > 0) {
    for (const problem of problems) process.stderr.write(`[memory-repo] ${problem}\n`);
    process.exit(1);
  }
}

function writePolicyFile(relPath: string, content: string): void {
  const target = path.join(memoryDir, relPath);
  if (existsSync(target) && !force) {
    const current = readFileSync(target, 'utf-8');
    if (current === content) return;
    process.stderr.write(`[memory-repo] keeping existing ${relPath}; use --force to replace\n`);
    return;
  }
  writeFileSync(target, content);
}

function ensureRemote(remoteUrl: string): void {
  if (!existsSync(path.join(memoryDir, '.git'))) fail('use --init before setting --remote');
  const current = readRemote();
  if (!current) {
    git(['remote', 'add', 'origin', remoteUrl], memoryDir);
  } else if (current !== remoteUrl) {
    process.stderr.write(`[memory-repo] remote already set to ${current}; leaving unchanged\n`);
  }
}

function readRemote(): string | null {
  if (!existsSync(path.join(memoryDir, '.git'))) return null;
  const result = git(['remote', 'get-url', 'origin'], memoryDir, { allowFailure: true });
  return result.exitCode === 0 ? result.stdout.trim() : null;
}

function collectFiles(root: string): Array<{ relPath: string; bytes: number }> {
  const out: Array<{ relPath: string; bytes: number }> = [];
  walk(root, '');
  return out;

  function walk(absDir: string, relDir: string): void {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const abs = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, rel);
      } else if (entry.isFile()) {
        out.push({ relPath: rel, bytes: statSync(abs).size });
      }
    }
  }
}

function readArg(name: string): string | undefined {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(name);
  if (index >= 0) return argv[index + 1];
  const prefix = `${name}=`;
  return argv.find(arg => arg.startsWith(prefix))?.slice(prefix.length);
}

function git(args: string[], cwd: string, options?: { allowFailure?: false }): string;
function git(args: string[], cwd: string, options: { allowFailure: true }): { exitCode: number; stdout: string; stderr: string };
function git(args: string[], cwd: string, options: { allowFailure?: boolean } = {}): string | { exitCode: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('git', args, {
      cwd,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    });
    return options.allowFailure ? { exitCode: 0, stdout, stderr: '' } : stdout;
  } catch (error) {
    if (options.allowFailure) {
      const e = error as { status?: number; stdout?: Buffer | string; stderr?: Buffer | string };
      return {
        exitCode: e.status ?? 1,
        stdout: String(e.stdout ?? ''),
        stderr: String(e.stderr ?? ''),
      };
    }
    throw error;
  }
}

function fail(message: string): never {
  process.stderr.write(`[memory-repo] ${message}\n`);
  process.exit(1);
}
