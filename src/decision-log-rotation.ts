/**
 * decision-log-rotation.ts
 *
 * Size-based rotation for myelin decision logs (append-only .jsonl files).
 * Triggered from housekeeping every 10 cycles.
 *
 * Strategy:
 *  - If a log file >= ROTATION_SIZE_BYTES, rename it to <base>-YYYYMMDD-HHmmss.jsonl
 *    inside memory/decisions-archive/ and let myelinate create a fresh file next write.
 *  - No compression by default (keeps implementation simple and reversible).
 *  - Historical data is never deleted — only moved to the archive directory.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getMemoryRootDir } from './memory-paths.js';

/** Rotate when a single file exceeds 1 MB. */
export const ROTATION_SIZE_BYTES = 1_000_000;

/** Sub-directory inside memory/ where archived logs are stored. */
const ARCHIVE_SUBDIR = 'decisions-archive';

/** All decision log paths (relative to process.cwd(), matching myelin-fleet.ts). */
export const DECISION_LOG_PATHS = [
  'memory/myelin-decisions.jsonl',
  'memory/myelin-learning-decisions.jsonl',
  'memory/myelin-routing-decisions.jsonl',
  'memory/myelin-workflow-decisions.jsonl',
  'memory/research-decisions.jsonl',
] as const;

function archiveDir(): string {
  return path.join(getMemoryRootDir(), ARCHIVE_SUBDIR);
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

export interface RotationResult {
  rotated: boolean;
  logPath: string;
  archivedAs?: string;
  sizeBytes?: number;
}

/**
 * Rotate a single decision log if it exceeds ROTATION_SIZE_BYTES.
 * Returns rotation metadata.
 */
export function rotateDecisionLog(logPath: string): RotationResult {
  const abs = path.resolve(logPath);
  if (!fs.existsSync(abs)) return { rotated: false, logPath };

  let stat: fs.Stats;
  try {
    stat = fs.statSync(abs);
  } catch {
    return { rotated: false, logPath };
  }

  if (stat.size < ROTATION_SIZE_BYTES) return { rotated: false, logPath, sizeBytes: stat.size };

  // Ensure archive directory exists.
  const dir = archiveDir();
  fs.mkdirSync(dir, { recursive: true });

  const base = path.basename(abs, '.jsonl');
  const archivedName = `${base}-${timestamp()}.jsonl`;
  const archivedAs = path.join(dir, archivedName);

  fs.renameSync(abs, archivedAs);

  return { rotated: true, logPath, archivedAs, sizeBytes: stat.size };
}

export interface BatchRotationResult {
  rotated: number;
  results: RotationResult[];
}

/**
 * Rotate all known decision logs. Safe to call every N cycles.
 */
export function rotateAllDecisionLogs(): BatchRotationResult {
  const results = DECISION_LOG_PATHS.map((p) => rotateDecisionLog(p));
  return {
    rotated: results.filter((r) => r.rotated).length,
    results,
  };
}
