import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, statSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Issue #422 regression coverage.
//
// Root cause: feedback-loops.ts kept a process-lifetime in-memory state cache
// with no mtime check. Out-of-band writers (notably `pnpm error-patterns:resolve`,
// which runs as an independent subprocess) stamp `resolvedAt`/`resolvedBy`
// directly on disk. The next `flushFeedbackState` in the live OODA loop then
// serialised its stale cache back to disk, silently stripping those fields.
//
// Observed symptom: `TIMEOUT:silent_exit_void_http::callClaude` had
// resolvedAt=2026-05-08T17:43:30Z stamped after PR #415 merged, then the file
// was rewritten 9h later with resolvedAt=null while count/lastSeen were
// preserved unchanged — the smoking gun for a stale cache clobber.

let tmpStateDir: string;
const stateFile = () => path.join(tmpStateDir, 'error-patterns.json');
const mocks = vi.hoisted(() => ({
  queryErrorLogs: vi.fn(),
}));

vi.mock('../src/memory.js', () => ({
  getMemoryStateDir: () => tmpStateDir,
  getMemory: () => ({}),
  invalidateFlagCache: () => {},
}));

vi.mock('../src/utils.js', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, slog: () => {} };
});

vi.mock('../src/logging.js', () => ({
  getLogger: () => ({ queryErrorLogs: mocks.queryErrorLogs }),
}));

import {
  detectErrorPatterns,
  readState,
  writeState,
  flushFeedbackState,
  _resetFeedbackStateCacheForTests,
} from '../src/feedback-loops.js';

type ErrorPattern = {
  count: number;
  taskCreated: boolean;
  lastSeen: string;
  lastMessage?: string;
  resolvedAt?: string;
  resolvedBy?: string;
  staleResolvedAt?: string;
  staleResolvedBy?: string | null;
};
type State = Record<string, ErrorPattern>;

function writeStateFileDirect(state: State): void {
  mkdirSync(tmpStateDir, { recursive: true });
  writeFileSync(stateFile(), `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
}

function bumpMtime(filePath: string, deltaMs = 1000): void {
  // Push mtime forward so the cache's mtime snapshot is strictly less than disk.
  // Some filesystems have second-granularity mtimes; +1s guarantees a strict bump.
  const now = new Date(Date.now() + deltaMs);
  utimesSync(filePath, now, now);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-06-03T12:00:00.000Z'));
  tmpStateDir = mkdtempSync(path.join(tmpdir(), 'fb-loops-422-'));
  mocks.queryErrorLogs.mockReset();
  _resetFeedbackStateCacheForTests();
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(tmpStateDir, { recursive: true, force: true });
});

describe('issue #422 — error-patterns resolvedAt strip', () => {
  it('readState reloads when disk advances (resolve script wrote between cycles)', () => {
    // Cycle 1: cache populates from initial disk state (no resolvedAt yet).
    writeStateFileDirect({
      'TIMEOUT:silent_exit_void_http::callClaude': {
        count: 3,
        taskCreated: false,
        lastSeen: '2026-05-08',
        lastMessage: 'silent exit void',
      },
    });
    const first = readState<State>('error-patterns.json', {});
    expect(first['TIMEOUT:silent_exit_void_http::callClaude'].resolvedAt).toBeUndefined();

    // Out-of-band writer (resolve script) stamps resolvedAt directly to disk.
    writeStateFileDirect({
      'TIMEOUT:silent_exit_void_http::callClaude': {
        count: 3,
        taskCreated: false,
        lastSeen: '2026-05-08',
        lastMessage: 'silent exit void',
        resolvedAt: '2026-05-08T17:43:30.000Z',
        resolvedBy: '09a5ccc3',
      },
    });
    bumpMtime(stateFile());

    // Cycle 2: a fresh readState in the same process must see the new resolution
    // — pre-fix behaviour was a cache hit returning stale data.
    const second = readState<State>('error-patterns.json', {});
    expect(second['TIMEOUT:silent_exit_void_http::callClaude'].resolvedAt).toBe('2026-05-08T17:43:30.000Z');
    expect(second['TIMEOUT:silent_exit_void_http::callClaude'].resolvedBy).toBe('09a5ccc3');
  });

  it('flushFeedbackState does not clobber an out-of-band resolvedAt stamp', () => {
    // Initial disk state — cycle starts.
    writeStateFileDirect({
      'TIMEOUT:silent_exit_void_http::callClaude': {
        count: 3,
        taskCreated: false,
        lastSeen: '2026-05-08',
      },
      // Unrelated entry the loop will mutate this cycle (drives `changed=true`
      // and forces a flush).
      'UNRELATED:foo::bar': {
        count: 2,
        taskCreated: false,
        lastSeen: '2026-05-08',
      },
    });

    const state = readState<State>('error-patterns.json', {});

    // Resolve script runs out-of-band: stamps resolvedAt on the http entry.
    writeStateFileDirect({
      'TIMEOUT:silent_exit_void_http::callClaude': {
        count: 3,
        taskCreated: false,
        lastSeen: '2026-05-08',
        resolvedAt: '2026-05-08T17:43:30.000Z',
        resolvedBy: '09a5ccc3',
      },
      'UNRELATED:foo::bar': {
        count: 2,
        taskCreated: false,
        lastSeen: '2026-05-08',
      },
    });
    bumpMtime(stateFile());

    // Loop continues in this cycle: it has no work to do for the http entry,
    // but it touches the unrelated entry and writeState/flush — pre-fix, that
    // flush serialised the stale cache and stripped resolvedAt.
    state['UNRELATED:foo::bar'].count = 4;
    writeState('error-patterns.json', state);
    flushFeedbackState();

    const onDisk = JSON.parse(readFileSync(stateFile(), 'utf-8')) as State;
    expect(onDisk['TIMEOUT:silent_exit_void_http::callClaude'].resolvedAt).toBe('2026-05-08T17:43:30.000Z');
    expect(onDisk['TIMEOUT:silent_exit_void_http::callClaude'].resolvedBy).toBe('09a5ccc3');
    expect(onDisk['UNRELATED:foo::bar'].count).toBe(4);
  });

  it('writeState then flush updates cache mtime so subsequent reads stay cache-hot', () => {
    // Guard against a regression where mtime tracking forgets the post-flush
    // mtime and causes spurious reloads (which would also drop in-flight changes
    // by re-reading our just-written disk image).
    writeStateFileDirect({});
    readState<State>('error-patterns.json', {});

    const next: State = {
      'X:Y::Z': { count: 5, taskCreated: false, lastSeen: '2026-05-09' },
    };
    writeState('error-patterns.json', next);
    flushFeedbackState();

    // No out-of-band writer; same mtime should be respected as cache-hot.
    const after = readState<State>('error-patterns.json', {});
    expect(after['X:Y::Z'].count).toBe(5);
    // And it must still be on disk identically.
    const disk = JSON.parse(readFileSync(stateFile(), 'utf-8')) as State;
    expect(disk['X:Y::Z'].count).toBe(5);
  });

  it('detectErrorPatterns clears resolvedAt when an existing bucket re-fires after resolution', async () => {
    const key = 'TIMEOUT:real_timeout::callClaude';
    writeStateFileDirect({
      [key]: {
        count: 5,
        taskCreated: false,
        lastSeen: '2026-05-22',
        resolvedAt: '2026-05-22T05:23:17.000Z',
        resolvedBy: 'abc123',
      },
    });

    mocks.queryErrorLogs.mockReturnValue([
      {
        timestamp: '2026-06-03T09:27:00.000Z',
        data: { context: 'callClaude', error: 'TIMEOUT took too long' },
      },
      {
        timestamp: '2026-06-03T09:28:00.000Z',
        data: { context: 'callClaude', error: 'TIMEOUT took too long' },
      },
      {
        timestamp: '2026-06-03T09:29:00.000Z',
        data: { context: 'callClaude', error: 'TIMEOUT took too long' },
      },
    ]);

    await detectErrorPatterns();
    flushFeedbackState();

    const onDisk = JSON.parse(readFileSync(stateFile(), 'utf-8')) as State;
    expect(onDisk[key].resolvedAt).toBeUndefined();
    expect(onDisk[key].resolvedBy).toBeUndefined();
    expect(onDisk[key].staleResolvedAt).toBe('2026-05-22T05:23:17.000Z');
    expect(onDisk[key].staleResolvedBy).toBe('abc123');
    expect(onDisk[key].lastSeen).toBe('2026-06-03');
    expect(onDisk[key].lastSeenAt).toBe('2026-06-03T09:29:00.000Z');
  });
});
