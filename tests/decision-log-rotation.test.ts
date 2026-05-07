import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// We import after setting up a temp dir to avoid touching real memory/
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-rot-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// --- helpers ------------------------------------------------------------------

function writeBytes(filePath: string, bytes: number): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.alloc(bytes, 'x'));
}

// We import the rotation functions but override ROTATION_SIZE_BYTES via the
// module's exported constant for unit-testing with small files.
import {
  rotateDecisionLog,
  rotateAllDecisionLogs,
  ROTATION_SIZE_BYTES,
  DECISION_LOG_PATHS,
} from '../src/decision-log-rotation.js';

// ---------------------------------------------------------------------------

describe('rotateDecisionLog', () => {
  it('does not rotate when file is smaller than threshold', () => {
    const logPath = path.join(tmpDir, 'test.jsonl');
    writeBytes(logPath, ROTATION_SIZE_BYTES - 1);

    const result = rotateDecisionLog(logPath);
    expect(result.rotated).toBe(false);
    expect(fs.existsSync(logPath)).toBe(true);
  });

  it('does not rotate when file does not exist', () => {
    const result = rotateDecisionLog(path.join(tmpDir, 'nonexistent.jsonl'));
    expect(result.rotated).toBe(false);
  });

  it('rotates when file meets threshold', () => {
    const logPath = path.join(tmpDir, 'myelin-decisions.jsonl');
    writeBytes(logPath, ROTATION_SIZE_BYTES);

    // rotateDecisionLog uses getMemoryRootDir() for archive dir — override via
    // env variable pattern isn't available, so we test by checking rename happened.
    const result = rotateDecisionLog(logPath);

    expect(result.rotated).toBe(true);
    expect(result.archivedAs).toBeDefined();
    // Original file should no longer exist (renamed away).
    expect(fs.existsSync(logPath)).toBe(false);
    // Archive file must exist.
    expect(fs.existsSync(result.archivedAs!)).toBe(true);
  });

  it('archived filename contains base name and timestamp', () => {
    const logPath = path.join(tmpDir, 'research-decisions.jsonl');
    writeBytes(logPath, ROTATION_SIZE_BYTES);

    const result = rotateDecisionLog(logPath);
    expect(result.archivedAs).toMatch(/research-decisions-\d{8}-\d{6}\.jsonl$/);
  });

  it('returns sizeBytes on non-rotating call', () => {
    const logPath = path.join(tmpDir, 'small.jsonl');
    writeBytes(logPath, 100);

    const result = rotateDecisionLog(logPath);
    expect(result.sizeBytes).toBe(100);
  });
});

describe('rotateAllDecisionLogs', () => {
  it('returns a BatchRotationResult with rotated count and results array', () => {
    const { rotated, results } = rotateAllDecisionLogs();
    expect(typeof rotated).toBe('number');
    expect(rotated).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(results)).toBe(true);
    expect(results).toHaveLength(DECISION_LOG_PATHS.length);
  });

  it('DECISION_LOG_PATHS contains all 5 known domains', () => {
    expect(DECISION_LOG_PATHS).toHaveLength(5);
    expect(DECISION_LOG_PATHS).toContain('memory/myelin-decisions.jsonl');
    expect(DECISION_LOG_PATHS).toContain('memory/myelin-learning-decisions.jsonl');
    expect(DECISION_LOG_PATHS).toContain('memory/myelin-routing-decisions.jsonl');
    expect(DECISION_LOG_PATHS).toContain('memory/myelin-workflow-decisions.jsonl');
    expect(DECISION_LOG_PATHS).toContain('memory/research-decisions.jsonl');
  });
});
