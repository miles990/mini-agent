import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getMyelinStatus } from '../src/myelin-status.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-myelin-status-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('getMyelinStatus', () => {
  it('reports effective domains from durable rules and decision logs', () => {
    writeJson('myelin-routing-rules.json', [
      { id: 'rule-1', action: 'foreground', hitCount: 12, reason: 'route replies foreground' },
      { id: 'rule-2', action: 'background', hitCount: 3, reason: 'route research background' },
    ]);
    writeLines('myelin-routing-decisions.jsonl', [
      { _type: 'decision', ts: '2026-05-05T00:00:00.000Z', method: 'llm', action: 'foreground' },
      { _type: 'decision', ts: '2026-05-05T00:01:00.000Z', method: 'rule', action: 'foreground' },
      { _type: 'crystallization', ts: '2026-05-05T00:02:00.000Z', event: 'distill_complete' },
    ]);

    const status = getMyelinStatus(tmpDir, 10);
    const routing = status.domains.find(domain => domain.name === 'routing');

    expect(routing).toEqual(expect.objectContaining({
      health: 'effective',
      ruleCount: 2,
      hitCountSum: 15,
      decisionLines: 3,
      lastDecisionAt: '2026-05-05T00:01:00.000Z',
      lastCrystallizedAt: '2026-05-05T00:02:00.000Z',
    }));
    expect(routing?.recent).toEqual(expect.objectContaining({
      total: 3,
      rule: 1,
      llm: 1,
      crystallization: 1,
    }));
    expect(routing?.topRules[0]).toEqual(expect.objectContaining({
      id: 'rule-1',
      hitCount: 12,
    }));
    expect(status.summary.totalRules).toBe(2);
  });

  it('distinguishes recording, idle, and missing domains', () => {
    writeJson('myelin-learning-rules.json', []);
    writeLines('myelin-learning-decisions.jsonl', [
      { _type: 'decision', ts: '2026-05-05T00:00:00.000Z', method: 'llm', action: 'connect' },
    ]);
    writeJson('myelin-workflow-rules.json', [
      { id: 'rule-idle', action: 'evolve', hitCount: 0, reason: 'seed rule' },
    ]);
    writeLines('myelin-workflow-decisions.jsonl', [
      { _type: 'crystallization', ts: '2026-05-05T00:00:00.000Z', event: 'distill_complete' },
    ]);

    const status = getMyelinStatus(tmpDir);

    expect(status.domains.find(domain => domain.name === 'learning')?.health).toBe('recording');
    expect(status.domains.find(domain => domain.name === 'workflow')?.health).toBe('idle');
    expect(status.domains.find(domain => domain.name === 'research')?.health).toBe('missing');
  });
});

function writeJson(file: string, value: unknown): void {
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(path.join(tmpDir, file), JSON.stringify(value, null, 2), 'utf-8');
}

function writeLines(file: string, records: unknown[]): void {
  mkdirSync(tmpDir, { recursive: true });
  writeFileSync(path.join(tmpDir, file), records.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf-8');
}
