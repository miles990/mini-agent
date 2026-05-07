import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { getReviewBacklog } from '../src/memory.js';
import { pruneReviewBacklog } from '../src/review-backlog-janitor.js';

describe('review backlog prompt feed', () => {
  let tmpDir: string;
  let oldDataDir: string | undefined;

  beforeEach(() => {
    oldDataDir = process.env.MINI_AGENT_DATA_DIR;
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-review-backlog-'));
    process.env.MINI_AGENT_DATA_DIR = tmpDir;
  });

  afterEach(() => {
    if (oldDataDir === undefined) {
      delete process.env.MINI_AGENT_DATA_DIR;
    } else {
      process.env.MINI_AGENT_DATA_DIR = oldDataDir;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeBacklog(instanceId: string, entries: unknown[]): void {
    const instanceDir = path.join(tmpDir, 'instances', instanceId);
    mkdirSync(instanceDir, { recursive: true });
    writeFileSync(path.join(instanceDir, 'review-backlog.jsonl'), entries.map(entry => JSON.stringify(entry)).join('\n') + '\n');
  }

  it('returns the newest 10 entries in descending order', () => {
    const now = Date.now();
    const entries = Array.from({ length: 35 }, (_, index) => ({
      id: `delegation-${index}`,
      type: 'delegation',
      summary: `useful result ${index}`,
      archivedAt: new Date(now - index * 60_000).toISOString(),
    })).reverse();

    writeBacklog('kuro', entries);

    const backlog = getReviewBacklog('kuro');

    expect(backlog).toHaveLength(10);
    expect(backlog[0].id).toBe('delegation-0');
    expect(backlog[9].id).toBe('delegation-9');
    expect(backlog.map(entry => entry.archivedAt)).toEqual(
      [...backlog].map(entry => entry.archivedAt).sort((a, b) => Date.parse(b) - Date.parse(a)),
    );
  });

  it('compacts the backlog file to the same bounded actionable set', () => {
    const now = Date.parse('2026-05-07T12:00:00.000Z');
    const entries = Array.from({ length: 14 }, (_, index) => ({
      id: `delegation-${index}`,
      type: 'delegation',
      summary: index === 1 ? '[FAILED shell] command exited 2' : `useful result ${index}`,
      archivedAt: new Date(now - index * 60_000).toISOString(),
    }));
    entries.push({
      id: 'expired',
      type: 'delegation',
      summary: 'useful but old',
      archivedAt: new Date(now - 7 * 3600_000).toISOString(),
    });

    writeBacklog('kuro', entries);

    const result = pruneReviewBacklog('kuro', now);
    const backlog = getReviewBacklog('kuro', now);

    expect(result).toEqual({ pruned: 5, remaining: 10 });
    expect(backlog).toHaveLength(10);
    expect(backlog.map(entry => entry.id)).not.toContain('delegation-1');
    expect(backlog.map(entry => entry.id)).not.toContain('expired');
  });

  it('filters expired entries and failure-only noise before rendering', () => {
    const now = Date.now();
    writeBacklog('kuro', [
      {
        id: 'expired',
        type: 'delegation',
        summary: 'useful but too old',
        archivedAt: new Date(now - 4 * 24 * 3600_000).toISOString(),
      },
      {
        id: 'failed-shell',
        type: 'delegation',
        summary: '[FAILED shell] command exited 2',
        archivedAt: new Date(now - 60_000).toISOString(),
      },
      {
        id: 'dispatch-error',
        type: 'delegation',
        summary: 'dispatch error: provider unavailable',
        archivedAt: new Date(now - 50_000).toISOString(),
      },
      {
        id: 'empty-output',
        type: 'delegation',
        summary: '(no output)',
        archivedAt: new Date(now - 40_000).toISOString(),
      },
      {
        id: 'valid',
        type: 'delegation',
        summary: 'review produced a useful diagnosis',
        archivedAt: new Date(now - 30_000).toISOString(),
      },
    ]);

    expect(getReviewBacklog('kuro').map(entry => entry.id)).toEqual(['valid']);
  });
});
