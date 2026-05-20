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
  mitigationKind?: 'circuit_breaker' | 'retry' | 'fallback' | 'expected_steady_state';
};

const state: { patterns: Record<string, Pattern> } = { patterns: {} };

vi.mock('../src/feedback-loops.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    readState: <T>(filename: string, fallback: T): T => {
      if (filename === 'error-patterns.json') {
        return state.patterns as unknown as T;
      }
      return fallback;
    },
    writeState: () => {},
  };
});

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
    // lastSeen ~12h after resolvedAt (same day) → inside the 24h grace window.
    // Relative dates keep the fixture fresh so the staleness filter never eats it.
    state.patterns = {
      'UNKNOWN:transient_fast_band::callClaude': {
        count: 9,
        taskCreated: false,
        lastSeen: isoDaysAgo(2),
        resolvedAt: `${isoDaysAgo(2)}T12:00:00.000Z`,
        resolvedBy: 'fdfc60b6',
      },
    };
    expect(buildErrorPatternsHint()).toBe('');
  });

  it('surfaces ship-resolved entries as regressions after the grace window', () => {
    // lastSeen ~3 days after resolvedAt → past the 24h grace window, and still
    // fresh (1 day ago) so it is not dropped by the 7-day staleness filter.
    state.patterns = {
      'UNKNOWN:transient_fast_band::callClaude': {
        count: 9,
        taskCreated: false,
        lastSeen: isoDaysAgo(1),
        resolvedAt: `${isoDaysAgo(4)}T12:00:00.000Z`,
        resolvedBy: 'fdfc60b6',
      },
    };
    const out = buildErrorPatternsHint();
    expect(out).toContain('[REGRESSION] UNKNOWN:transient_fast_band::callClaude');
  });

  it('suppresses [REGRESSION] tag for mitigated patterns after grace window — issue #455', () => {
    // mitigationKind signals the recurrence is expected steady-state (e.g. circuit-breaker
    // fast-fails still increment the counter). Should NOT spawn a P0 triage loop.
    state.patterns = {
      'UNKNOWN:transient_fast_band::callClaude': {
        count: 38,
        taskCreated: false,
        lastSeen: '2026-05-10',
        resolvedAt: '2026-05-08T02:47:00.000Z',
        resolvedBy: 'fdfc60b6',
        mitigationKind: 'circuit_breaker',
      },
    };
    const out = buildErrorPatternsHint();
    expect(out).not.toContain('[REGRESSION]');
    // The pattern itself should not surface (mitigated recurrence after grace returns false)
    expect(out).toBe('');
  });

  it('omits PROTECTIVE_SUBTYPES even when fresh and high-count — issue #512', () => {
    state.patterns = {
      'TIMEOUT:sigterm_shutdown::callClaude': {
        count: 9,
        taskCreated: true,
        lastSeen: isoDaysAgo(0),
      },
      'TIMEOUT:sigterm_hard::callClaude': {
        count: 5,
        taskCreated: true,
        lastSeen: isoDaysAgo(1),
      },
      'TIMEOUT:budget_exceeded::callClaude': {
        count: 4,
        taskCreated: true,
        lastSeen: isoDaysAgo(0),
      },
    };
    expect(buildErrorPatternsHint()).toBe('');
  });

  it('keeps actionable bug subtypes alongside protective ones — issue #512', () => {
    state.patterns = {
      'TIMEOUT:sigterm_shutdown::callClaude': {
        count: 9,
        taskCreated: true,
        lastSeen: isoDaysAgo(0),
      },
      'TIMEOUT:dns_lookup_failed::callClaude': {
        count: 4,
        taskCreated: true,
        lastSeen: isoDaysAgo(1),
      },
    };
    const out = buildErrorPatternsHint();
    expect(out).toContain('dns_lookup_failed');
    expect(out).not.toContain('sigterm_shutdown');
  });
});
