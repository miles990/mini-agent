/**
 * Token ledger — per-call token accounting.
 *
 * Before this, the SDK response's `usage` was slog'd and discarded; there was
 * no way to measure where tokens went. logTokenUsage persists each call to a
 * daily ledger; getTokenUsageSummary aggregates total spend + per-source.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { Logger } from '../src/logging.js';
import { getInstanceDir } from '../src/instance.js';

let instanceId: string;
let logger: Logger;

beforeEach(() => {
  instanceId = 'token-ledger-test-' + Math.random().toString(36).slice(2, 10);
  logger = new Logger(instanceId);
});

afterEach(() => {
  fs.rmSync(getInstanceDir(instanceId), { recursive: true, force: true });
});

const flush = () => new Promise(r => setTimeout(r, 100));

describe('Logger token ledger', () => {
  it('returns an empty summary when nothing is recorded', () => {
    const s = logger.getTokenUsageSummary();
    expect(s.calls).toBe(0);
    expect(s.totalInput).toBe(0);
    expect(s.bySource).toEqual({});
  });

  it('records token usage and aggregates totals + per-source', async () => {
    logger.logTokenUsage({ source: 'loop', model: 'claude-opus', input: 1000, output: 200, cacheRead: 500, cacheCreation: 100, durationMs: 2000 });
    logger.logTokenUsage({ source: 'loop', input: 800, output: 150, cacheRead: 400, cacheCreation: 0 });
    logger.logTokenUsage({ source: 'cron', input: 300, output: 50, cacheRead: 0, cacheCreation: 0 });
    await flush();

    const s = logger.getTokenUsageSummary();
    expect(s.calls).toBe(3);
    expect(s.totalInput).toBe(2100);
    expect(s.totalOutput).toBe(400);
    expect(s.totalCacheRead).toBe(900);
    expect(s.totalCacheCreation).toBe(100);

    expect(s.bySource.loop.calls).toBe(2);
    expect(s.bySource.loop.input).toBe(1800);
    expect(s.bySource.loop.output).toBe(350);
    expect(s.bySource.cron.calls).toBe(1);
    expect(s.bySource.cron.input).toBe(300);
  });

  it('isolates ledgers by date', async () => {
    logger.logTokenUsage({ source: 'loop', input: 500, output: 100, cacheRead: 0, cacheCreation: 0 });
    await flush();

    const today = new Date().toISOString().split('T')[0];
    expect(logger.getTokenUsageSummary(today).calls).toBe(1);
    expect(logger.getTokenUsageSummary('2020-01-01').calls).toBe(0);
  });
});
