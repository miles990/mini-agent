import fs from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { getMemoryRootDir } from './memory-paths.js';

export interface DecisionLogRotationOptions {
  memoryDir?: string;
  maxBytes?: number;
  archiveDir?: string;
  now?: Date;
  compress?: boolean;
  files?: string[];
}

export interface DecisionLogRotationResult {
  file: string;
  beforeBytes: number;
  afterBytes: number;
  archivedBytes: number;
  archivedLines: number;
  keptLines: number;
  archives: string[];
  skipped: boolean;
}

const DEFAULT_MAX_BYTES = 1024 * 1024;
const DEFAULT_DECISION_LOGS = [
  'myelin-decisions.jsonl',
  'myelin-learning-decisions.jsonl',
  'myelin-routing-decisions.jsonl',
  'myelin-workflow-decisions.jsonl',
  'research-decisions.jsonl',
  path.join('state', 'decision-provenance.jsonl'),
];

export function getDecisionLogFiles(): string[] {
  return [...DEFAULT_DECISION_LOGS];
}

export function rotateDecisionLogs(options: DecisionLogRotationOptions = {}): DecisionLogRotationResult[] {
  const memoryDir = options.memoryDir ?? getMemoryRootDir();
  const maxBytes = options.maxBytes ?? Number(process.env.MINI_AGENT_DECISION_LOG_MAX_BYTES ?? DEFAULT_MAX_BYTES);
  const archiveDir = options.archiveDir ?? path.join(memoryDir, 'decisions-archive');
  const files = options.files ?? DEFAULT_DECISION_LOGS;
  const now = options.now ?? new Date();
  const compress = options.compress ?? true;

  return files.map(file => rotateOneDecisionLog({
    file,
    memoryDir,
    maxBytes,
    archiveDir,
    now,
    compress,
  }));
}

function rotateOneDecisionLog(options: Required<Omit<DecisionLogRotationOptions, 'files'>> & { file: string }): DecisionLogRotationResult {
  const filePath = path.resolve(options.memoryDir, options.file);
  if (!fs.existsSync(filePath)) {
    return emptyResult(options.file, 0, true);
  }

  const beforeBytes = fs.statSync(filePath).size;
  if (beforeBytes <= options.maxBytes) {
    return emptyResult(options.file, beforeBytes, true);
  }

  const lines = fs.readFileSync(filePath, 'utf-8').split('\n').filter(Boolean);
  const { keep, archiveChunks } = splitForRotation(lines, options.maxBytes);
  if (archiveChunks.length === 0) {
    return emptyResult(options.file, beforeBytes, true);
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.mkdirSync(options.archiveDir, { recursive: true });

  const stamp = timestampStamp(options.now);
  const stem = path.basename(options.file, '.jsonl');
  const archives: string[] = [];
  let archivedBytes = 0;
  let archivedLines = 0;

  archiveChunks.forEach((chunk, index) => {
    const plain = chunk.join('\n') + '\n';
    const suffix = `${stamp}-part${String(index + 1).padStart(2, '0')}.jsonl`;
    const archivePath = path.join(options.archiveDir, `${stem}-${suffix}${options.compress ? '.gz' : ''}`);
    if (options.compress) {
      fs.writeFileSync(archivePath, gzipSync(plain), { flag: 'wx' });
    } else {
      fs.writeFileSync(archivePath, plain, { flag: 'wx' });
    }
    archives.push(archivePath);
    archivedBytes += Buffer.byteLength(plain);
    archivedLines += chunk.length;
  });

  const active = keep.length > 0 ? keep.join('\n') + '\n' : '';
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, active, 'utf-8');
  fs.renameSync(tmpPath, filePath);

  return {
    file: options.file,
    beforeBytes,
    afterBytes: fs.statSync(filePath).size,
    archivedBytes,
    archivedLines,
    keptLines: keep.length,
    archives,
    skipped: false,
  };
}

function splitForRotation(lines: string[], maxBytes: number): { keep: string[]; archiveChunks: string[][] } {
  const keep: string[] = [];
  let keepBytes = 0;

  for (let i = lines.length - 1; i >= 0; i--) {
    const lineBytes = Buffer.byteLength(lines[i]) + 1;
    if (keep.length > 0 && keepBytes + lineBytes > maxBytes) break;
    if (lineBytes > maxBytes && keep.length === 0) {
      keep.unshift(lines[i]);
      keepBytes += lineBytes;
      continue;
    }
    keep.unshift(lines[i]);
    keepBytes += lineBytes;
  }

  const archiveLineCount = Math.max(0, lines.length - keep.length);
  const archiveLines = lines.slice(0, archiveLineCount);
  const archiveChunks: string[][] = [];
  let chunk: string[] = [];
  let chunkBytes = 0;

  for (const line of archiveLines) {
    const lineBytes = Buffer.byteLength(line) + 1;
    if (chunk.length > 0 && chunkBytes + lineBytes > maxBytes) {
      archiveChunks.push(chunk);
      chunk = [];
      chunkBytes = 0;
    }
    chunk.push(line);
    chunkBytes += lineBytes;
  }
  if (chunk.length > 0) archiveChunks.push(chunk);

  return { keep, archiveChunks };
}

function emptyResult(file: string, bytes: number, skipped: boolean): DecisionLogRotationResult {
  return {
    file,
    beforeBytes: bytes,
    afterBytes: bytes,
    archivedBytes: 0,
    archivedLines: 0,
    keptLines: 0,
    archives: [],
    skipped,
  };
}

function timestampStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
