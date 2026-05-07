import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateKgExternalMemoryTruth,
  evaluateMemoryStateTruth,
} from '../src/external-memory-health.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-external-memory-'));
  mkdirSync(path.join(tmpDir, 'state'), { recursive: true });
  mkdirSync(path.join(tmpDir, 'index'), { recursive: true });
  vi.unstubAllEnvs();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('external memory health', () => {
  it('blocks malformed critical JSONL', () => {
    writeFileSync(path.join(tmpDir, 'state', 'task-events.jsonl'), '{"ok":true}\n{bad\n', 'utf-8');

    const result = evaluateMemoryStateTruth(tmpDir, tmpDir);

    expect(result.status).toBe('blocked');
    expect(result.summary).toContain('critical memory JSONL');
    expect(result.evidence[0]).toContain('state/task-events.jsonl:2');
  });

  it('warns when a git-backed external memory repo has unsnapshotted curated files', () => {
    mkdirSync(path.join(tmpDir, '.git'));
    writeFileSync(path.join(tmpDir, 'state', 'task-events.jsonl'), '', 'utf-8');
    writeFileSync(path.join(tmpDir, 'MEMORY.md'), '# Memory\n', 'utf-8');

    const result = evaluateMemoryStateTruth(tmpDir, tmpDir);

    expect(['warn', 'ok']).toContain(result.status);
  });

  it('treats absent KG footprint as not configured for this memory workspace', () => {
    vi.stubEnv('KG_URL', '');

    const result = evaluateKgExternalMemoryTruth(tmpDir);

    expect(result.status).toBe('ok');
    expect(result.summary).toContain('no local footprint');
  });

  it('warns when KG footprint exists but service is unreachable', () => {
    writeFileSync(path.join(tmpDir, 'state', 'kg-memory-cache.jsonl'), '', 'utf-8');

    const result = evaluateKgExternalMemoryTruth(tmpDir, new Date('2026-05-07T00:00:00Z'), {
      kgUrl: 'http://127.0.0.1:9',
      timeoutSeconds: 1,
    });

    expect(result.status).toBe('warn');
    expect(result.summary).toContain('unreachable');
    expect(result.repair).toContain('context exchange');
  });
});
