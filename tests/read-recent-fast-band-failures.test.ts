import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readRecentFastBandFailures } from '../src/feedback-loops.js';

// Issue #445 step 2 acceptance #4: outer fast-band gate read-path is unit-testable.
// Helper extracted from loop.ts wire so the gate's "read recent failures" logic
// can be exercised without booting AgentLoop. Wire test (loop.ts:2789-2797) calls
// this helper, then passes result to shouldThrottleFastBandWindow (already tested).
describe('readRecentFastBandFailures — fast-band gate read-path (#445)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'kuro-fb-gate-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns [] when error-patterns.json is missing', () => {
    expect(readRecentFastBandFailures(dir)).toEqual([]);
  });

  it('returns [] when error-patterns.json has no fast-band entry', () => {
    writeFileSync(
      path.join(dir, 'error-patterns.json'),
      JSON.stringify({ 'TIMEOUT:dns_lookup_failed::callClaude': { occurrences: ['2026-05-09T01:00:00.000Z'] } }),
    );
    expect(readRecentFastBandFailures(dir)).toEqual([]);
  });

  it('returns occurrences array when fast-band entry present', () => {
    const occurrences = [
      '2026-05-09T01:00:00.000Z',
      '2026-05-09T01:01:00.000Z',
      '2026-05-09T01:02:00.000Z',
    ];
    writeFileSync(
      path.join(dir, 'error-patterns.json'),
      JSON.stringify({ 'UNKNOWN:transient_fast_band::callClaude': { occurrences } }),
    );
    expect(readRecentFastBandFailures(dir)).toEqual(occurrences);
  });

  it('returns [] when fast-band entry exists but has no occurrences field', () => {
    writeFileSync(
      path.join(dir, 'error-patterns.json'),
      JSON.stringify({ 'UNKNOWN:transient_fast_band::callClaude': { count: 5 } }),
    );
    expect(readRecentFastBandFailures(dir)).toEqual([]);
  });

  it('returns [] on malformed JSON (gate stays open, fail-safe to callClaude)', () => {
    writeFileSync(path.join(dir, 'error-patterns.json'), '{not valid json');
    expect(readRecentFastBandFailures(dir)).toEqual([]);
  });

  it('returns [] when stateDir does not exist', () => {
    expect(readRecentFastBandFailures(path.join(dir, 'does-not-exist'))).toEqual([]);
  });
});
