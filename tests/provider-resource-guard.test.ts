import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendMemoryIndexEntry } from '../src/memory-index.js';
import {
  classifyProviderResourceHold,
  filterActorsForProviderResourceHolds,
  readActiveProviderResourceHolds,
} from '../src/provider-resource-guard.js';

describe('provider resource guard', () => {
  it('classifies Claude usage exhaustion with reset time', () => {
    const result = classifyProviderResourceHold(
      "Claude Code returned an error result: You're out of extra usage · resets 2:40am (Asia/Taipei)",
      new Date('2026-05-06T16:30:00.000Z'),
    );

    expect(result).toEqual(expect.objectContaining({
      type: 'provider-quota',
      provider: 'claude',
      resumeAt: '2026-05-06T18:40:00.000Z',
    }));
  });

  it('uses a conservative one-hour hold when no reset time is present', () => {
    const result = classifyProviderResourceHold(
      'provider failed: maximum budget exceeded',
      new Date('2026-05-06T16:30:00.000Z'),
    );

    expect(result).toEqual(expect.objectContaining({
      type: 'provider-quota',
      provider: 'unknown',
      resumeAt: '2026-05-06T17:30:00.000Z',
    }));
  });

  it('ignores normal command failures', () => {
    expect(classifyProviderResourceHold('Shell error: Command exited 1')).toBeNull();
  });

  it('reads active provider holds from held tasks', async () => {
    const memoryDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-provider-hold-'));
    try {
      await appendMemoryIndexEntry(memoryDir, {
        type: 'task',
        status: 'hold',
        summary: 'Hold Codex while quota is exhausted',
        refs: [],
        payload: {
          provider_resource_hold: {
            type: 'provider-quota',
            provider: 'codex',
            resumeAt: '2026-05-06T18:40:00.000Z',
            reason: 'codex provider quota/resource exhausted',
          },
        },
      });

      const holds = readActiveProviderResourceHolds(memoryDir, new Date('2026-05-06T18:30:00.000Z'));

      expect(holds).toHaveLength(1);
      expect(holds[0]).toEqual(expect.objectContaining({ provider: 'codex' }));
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });

  it('removes held providers from actor selection candidates', async () => {
    const memoryDir = mkdtempSync(path.join(os.tmpdir(), 'mini-agent-provider-hold-'));
    try {
      await appendMemoryIndexEntry(memoryDir, {
        type: 'task',
        status: 'hold',
        summary: 'Hold Claude while quota is exhausted',
        refs: [],
        payload: {
          provider_resource_hold: {
            type: 'provider-quota',
            provider: 'claude',
            resumeAt: '2026-05-06T18:40:00.000Z',
            reason: 'claude provider quota/resource exhausted',
          },
        },
      });

      const actors = filterActorsForProviderResourceHolds(
        ['claude', 'codex', 'akari', 'kuro'],
        memoryDir,
        new Date('2026-05-06T18:30:00.000Z'),
      );

      expect(actors).toEqual(['codex', 'akari', 'kuro']);
    } finally {
      rmSync(memoryDir, { recursive: true, force: true });
    }
  });
});
