import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  observe: vi.fn(),
  writeMemoryTriple: vi.fn(),
}));

vi.mock('../src/shared-knowledge.js', () => ({
  observe: mocks.observe,
}));

vi.mock('../src/kg-memory.js', () => ({
  writeMemoryTriple: mocks.writeMemoryTriple,
}));

import { syncMyelinToKnowledge } from '../src/myelin-kg-sync.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-myelin-kg-sync-'));
  mocks.observe.mockClear();
  mocks.writeMemoryTriple.mockClear();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('syncMyelinToKnowledge', () => {
  it('syncs top effective rules to shared knowledge and KG', () => {
    writeJson('myelin-routing-rules.json', [
      { id: 'rule-route', action: 'foreground', hitCount: 120, reason: 'reply routes foreground' },
    ]);
    writeLines('myelin-routing-decisions.jsonl', [
      { _type: 'decision', ts: '2026-05-05T00:00:00.000Z', method: 'rule', action: 'foreground' },
    ]);

    const result = syncMyelinToKnowledge(tmpDir);

    expect(result.observed).toBe(1);
    expect(mocks.observe).toHaveBeenCalledWith(expect.objectContaining({
      source: 'myelin',
      type: 'crystallize',
      data: expect.objectContaining({
        domain: 'routing',
        ruleId: 'rule-route',
        action: 'foreground',
        hitCount: 120,
      }),
      tags: expect.arrayContaining(['myelin', 'decision-pattern', 'routing', 'foreground']),
    }));
    expect(mocks.writeMemoryTriple).toHaveBeenCalledWith(expect.objectContaining({
      agent: 'kuro',
      predicate: 'learned',
      topic: 'myelin',
      importance: 'medium',
      visibility: 'shared',
    }));
  });

  it('skips unchanged rules after first sync unless forced', () => {
    writeJson('research-rules.json', [
      { id: 'rule-research', action: 'normal', hitCount: 400, reason: 'research pattern' },
    ]);
    writeLines('research-decisions.jsonl', [
      { _type: 'decision', ts: '2026-05-05T00:00:00.000Z', method: 'rule', action: 'normal' },
    ]);

    expect(syncMyelinToKnowledge(tmpDir).observed).toBe(1);
    mocks.observe.mockClear();
    mocks.writeMemoryTriple.mockClear();

    const second = syncMyelinToKnowledge(tmpDir);
    expect(second.observed).toBe(0);
    expect(second.skipped).toBe(1);
    expect(mocks.observe).not.toHaveBeenCalled();
    expect(mocks.writeMemoryTriple).not.toHaveBeenCalled();

    const forced = syncMyelinToKnowledge(tmpDir, { force: true });
    expect(forced.observed).toBe(1);
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
