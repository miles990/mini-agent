import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
    initGitMemory(tmpDir);
    writeFileSync(path.join(tmpDir, 'state', 'task-events.jsonl'), '', 'utf-8');
    writeFileSync(path.join(tmpDir, 'inner-notes.md'), '# Notes\n', 'utf-8');

    const result = evaluateMemoryStateTruth(tmpDir, tmpDir);

    expect(result.status).toBe('warn');
    expect(result.summary).toContain('1 curated memory git change');
    expect(result.evidence.join('\n')).toContain('inner-notes.md (curated-knowledge)');
  });

  it('does not warn for ignored high-frequency telemetry changes', () => {
    initGitMemory(tmpDir);
    writeFileSync(path.join(tmpDir, 'state', 'task-events.jsonl'), '', 'utf-8');
    writeFileSync(path.join(tmpDir, 'state', 'transient.json'), '{}', 'utf-8');

    const result = evaluateMemoryStateTruth(tmpDir, tmpDir);

    expect(result.status).toBe('ok');
  });

  it('blocks unchecked P0 recurring-error HEARTBEAT tasks with no live error-pattern support', () => {
    writeFileSync(path.join(tmpDir, 'state', 'task-events.jsonl'), '', 'utf-8');
    writeFileSync(path.join(tmpDir, 'state', 'error-patterns.json'), JSON.stringify({
      'TIMEOUT:silent_exit_void::callClaude': {
        count: 15,
        lastSeen: '2026-05-07',
        lastMessage: 'CLI silent_exit_void after 327s',
      },
    }), 'utf-8');
    writeFileSync(path.join(tmpDir, 'HEARTBEAT.md'), [
      '# HEARTBEAT',
      '## Active Tasks',
      '- [ ] **P0 Cannot read properties of unde:generic**（72 次, last 2026-04-25）：historical counter',
    ].join('\n'), 'utf-8');

    const result = evaluateMemoryStateTruth(tmpDir, tmpDir);

    expect(result.status).toBe('blocked');
    expect(result.summary).toContain('HEARTBEAT recurring-error');
    expect(result.evidence.join('\n')).toContain('unde:generic');
  });

  it('ignores retired recurring-error HEARTBEAT tasks wrapped in comments', () => {
    writeFileSync(path.join(tmpDir, 'state', 'task-events.jsonl'), '', 'utf-8');
    writeFileSync(path.join(tmpDir, 'state', 'error-patterns.json'), '{}', 'utf-8');
    writeFileSync(path.join(tmpDir, 'HEARTBEAT.md'), [
      '# HEARTBEAT',
      '## Active Tasks',
      '<!-- - [x] **P0 Cannot read properties of unde:generic**（72 次, last 2026-04-25）：historical counter -->',
    ].join('\n'), 'utf-8');

    const result = evaluateMemoryStateTruth(tmpDir, tmpDir);

    expect(result.status).toBe('ok');
  });

  it('keeps active recurring-error HEARTBEAT tasks when backed by a live error-pattern', () => {
    writeFileSync(path.join(tmpDir, 'state', 'task-events.jsonl'), '', 'utf-8');
    writeFileSync(path.join(tmpDir, 'state', 'error-patterns.json'), JSON.stringify({
      'TIMEOUT:silent_exit_void::callClaude': {
        count: 15,
        lastSeen: '2026-05-07',
        lastMessage: 'CLI silent_exit_void after 327s',
      },
    }), 'utf-8');
    writeFileSync(path.join(tmpDir, 'HEARTBEAT.md'), [
      '# HEARTBEAT',
      '## Active Tasks',
      '- [ ] **P1 silent_exit_void**（15 次, last 2026-05-07）：new live samples still need root cause',
    ].join('\n'), 'utf-8');

    const result = evaluateMemoryStateTruth(tmpDir, tmpDir);

    expect(result.status).toBe('ok');
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
    expect(result.evidence).toContain('probeAttempts=3');
    expect(result.repair).toContain('context exchange');
  });
});

function initGitMemory(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  writeFileSync(path.join(dir, '.git', 'info', 'exclude'), 'state/\n*.jsonl\n', 'utf-8');
}
