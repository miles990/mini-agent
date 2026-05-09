import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readRecentSlowBandFailures } from '../src/feedback-loops.js';

// Issue #439: slow-band gate read-path, mirroring readRecentFastBandFailures (#445).
// Helper extracted so the gate's "read recent failures" logic can be exercised
// without booting AgentLoop. The gate consumes the timestamps from
// error-patterns.json[UNKNOWN:transient_slow_band::callClaude].occurrences
// and feeds them to shouldThrottleSlowBandWindow.
describe('readRecentSlowBandFailures — slow-band gate read-path (#439)', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'kuro-sb-gate-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('returns [] when error-patterns.json is missing', () => {
    expect(readRecentSlowBandFailures(dir)).toEqual([]);
  });

  it('returns [] when error-patterns.json has no slow-band entry', () => {
    writeFileSync(
      path.join(dir, 'error-patterns.json'),
      JSON.stringify({ 'UNKNOWN:transient_fast_band::callClaude': { occurrences: ['2026-05-09T01:00:00.000Z'] } }),
    );
    expect(readRecentSlowBandFailures(dir)).toEqual([]);
  });

  it('returns occurrences array when slow-band entry present', () => {
    const occurrences = [
      '2026-05-09T00:08:39.265Z',
      '2026-05-09T00:18:00.000Z',
      '2026-05-09T00:37:19.559Z',
    ];
    writeFileSync(
      path.join(dir, 'error-patterns.json'),
      JSON.stringify({ 'UNKNOWN:transient_slow_band::callClaude': { occurrences } }),
    );
    expect(readRecentSlowBandFailures(dir)).toEqual(occurrences);
  });

  it('returns [] when slow-band entry exists but has no occurrences field', () => {
    writeFileSync(
      path.join(dir, 'error-patterns.json'),
      JSON.stringify({ 'UNKNOWN:transient_slow_band::callClaude': { count: 10 } }),
    );
    expect(readRecentSlowBandFailures(dir)).toEqual([]);
  });

  it('returns [] on malformed JSON (gate stays open, fail-safe to callClaude)', () => {
    writeFileSync(path.join(dir, 'error-patterns.json'), '{not valid json');
    expect(readRecentSlowBandFailures(dir)).toEqual([]);
  });

  it('returns [] when stateDir does not exist', () => {
    expect(readRecentSlowBandFailures(path.join(dir, 'does-not-exist'))).toEqual([]);
  });
});
