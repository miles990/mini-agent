import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface TestHealthFailure {
  file: string;
  failedCount?: number;
}

export interface TestHealthSnapshot {
  status: 'passed' | 'failed';
  command: string;
  exitCode: number;
  checkedAt: string;
  failedFiles: TestHealthFailure[];
  failedTests: string[];
  outputTail: string;
}

const SNAPSHOT_PATH = path.join('state', 'latest-test-health.json');

export function buildTestHealthSnapshot(
  command: string,
  exitCode: number,
  output: string,
  now = new Date(),
): TestHealthSnapshot {
  const failedFiles = parseFailedFiles(output);
  const failedTests = parseFailedTests(output);
  return {
    status: exitCode === 0 ? 'passed' : 'failed',
    command,
    exitCode,
    checkedAt: now.toISOString(),
    failedFiles,
    failedTests,
    outputTail: tail(output, 6000),
  };
}

export function readTestHealthSnapshot(memoryDir: string): TestHealthSnapshot | null {
  try {
    return JSON.parse(readFileSync(testHealthSnapshotPath(memoryDir), 'utf-8')) as TestHealthSnapshot;
  } catch {
    return null;
  }
}

export function writeTestHealthSnapshot(memoryDir: string, snapshot: TestHealthSnapshot): void {
  const file = testHealthSnapshotPath(memoryDir);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(snapshot, null, 2) + '\n', 'utf-8');
}

export function summarizeTestHealth(snapshot: TestHealthSnapshot): string {
  if (snapshot.status === 'passed') return `tests passed: ${snapshot.command}`;
  const files = snapshot.failedFiles.map(f => f.file).slice(0, 3).join(', ') || 'unknown files';
  return `tests failed: ${snapshot.command}; ${snapshot.failedFiles.length} file(s): ${files}`;
}

function testHealthSnapshotPath(memoryDir: string): string {
  return path.join(memoryDir, SNAPSHOT_PATH);
}

function parseFailedFiles(output: string): TestHealthFailure[] {
  const latest = new Map<string, TestHealthFailure>();
  for (const line of output.split(/\r?\n/)) {
    const summary = line.match(/[❯✓]\s+(tests\/\S+\.test\.ts)\s+\([^)]*\|\s+(\d+)\s+failed\)/);
    if (summary) {
      latest.set(summary[1], { file: summary[1], failedCount: Number(summary[2]) });
      continue;
    }
    const fail = line.match(/\bFAIL\s+(tests\/\S+\.test\.ts)\b/);
    if (fail && !latest.has(fail[1])) latest.set(fail[1], { file: fail[1] });
  }
  return [...latest.values()].sort((a, b) => a.file.localeCompare(b.file));
}

function parseFailedTests(output: string): string[] {
  const tests = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/\bFAIL\s+(.+?)\s+>/);
    if (match) tests.add(match[1].trim());
  }
  return [...tests].slice(0, 20);
}

function tail(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return text.slice(text.length - maxChars);
}
