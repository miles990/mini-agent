import { describe, it, expect, vi, beforeEach } from 'vitest';

// Issue #315: buildErrorPatternsHint must filter entries whose lastSeen is
// older than 7 days, so once-resolved-but-still-on-disk patterns stop wasting
// cycle attention.

type Pattern = {
  count: number;
  taskCreated: boolean;
  lastSeen: string;
  resolved?: boolean;
  resolvedAt?: string;
  resolvedBy?: string;
};

const state: { patterns: Record<string, Pattern> } = { patterns: {} };

vi.mock('../src/feedback-loops.js', () => ({
  readState: <T>(filename: string, fallback: T): T => {
    if (filename === 'error-patterns.json') {
      return state.patterns as unknown as T;
    }
    return fallback;
  },
  writeState: () => {},
}));

vi.mock('../src/utils.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, slog: () => {} };
});

import { buildErrorPatternsHint } from '../src/prompt-builder.js';

const isoDaysAgo = (days: number) =>
  new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

describe('buildErrorPatternsHint — issue #315 staleness filter', () => {
  beforeEach(() => {
    state.patterns = {};
  });

  it('omits entries with lastSeen older than 7 days', () => {
    state.patterns = {
      'TIMEOUT:dns_lookup_failed::callClaude': {
        count: 23,
        taskCreated: true,
        lastSeen: isoDaysAgo(10), // stale
      },
      'TIMEOUT:silent_exit_void::callClaude': {
        count: 17,
        taskCreated: true,
        lastSeen: isoDaysAgo(1), // fresh
      },
    };

    const out = buildErrorPatternsHint();

    expect(out).toContain('silent_exit_void');
    expect(out).not.toContain('dns_lookup_failed');
  });

  it('keeps entries within the 7-day window', () => {
    state.patterns = {
      'recent:problem': {
        count: 5,
        taskCreated: false,
        lastSeen: isoDaysAgo(6), // boundary-fresh
      },
    };
    expect(buildErrorPatternsHint()).toContain('recent:problem');
  });

  it('returns empty string when every actionable pattern is stale', () => {
    state.patterns = {
      'old:problem': {
        count: 99,
        taskCreated: true,
        lastSeen: isoDaysAgo(30),
      },
    };
    expect(buildErrorPatternsHint()).toBe('');
  });

  it('still drops resolved entries even if fresh', () => {
    state.patterns = {
      'fresh:resolved': {
        count: 10,
        taskCreated: true,
        lastSeen: isoDaysAgo(1),
        resolved: true,
      },
    };
    expect(buildErrorPatternsHint()).toBe('');
  });

  it('still drops entries with count < 3 even if fresh', () => {
    state.patterns = {
      'low:count': {
        count: 2,
        taskCreated: false,
        lastSeen: isoDaysAgo(1),
      },
    };
    expect(buildErrorPatternsHint()).toBe('');
  });

  it('treats malformed lastSeen as stale (defensive guard)', () => {
    state.patterns = {
      'bad:timestamp': {
        count: 5,
        taskCreated: false,
        lastSeen: 'not-a-date',
      },
    };
    expect(buildErrorPatternsHint()).toBe('');
  });

  it('omits ship-resolved entries inside the 1 day grace window', () => {
    state.patterns = {
      'UNKNOWN:transient_fast_band::callClaude': {
        count: 9,
        taskCreated: false,
        lastSeen: '2026-05-08',
        resolvedAt: '2026-05-08T02:47:00.000Z',
        resolvedBy: 'fdfc60b6',
      },
    };
    expect(buildErrorPatternsHint()).toBe('');
  });

  it('surfaces ship-resolved entries as regressions after the grace window', () => {
    state.patterns = {
      'UNKNOWN:transient_fast_band::callClaude': {
        count: 9,
        taskCreated: false,
        lastSeen: '2026-05-10',
        resolvedAt: '2026-05-08T02:47:00.000Z',
        resolvedBy: 'fdfc60b6',
      },
    };
    const out = buildErrorPatternsHint();
    expect(out).toContain('[REGRESSION] UNKNOWN:transient_fast_band::callClaude');
  });
});
