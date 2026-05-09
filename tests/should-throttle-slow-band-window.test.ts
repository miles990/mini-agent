import { describe, it, expect } from 'vitest';
import { shouldThrottleSlowBandWindow } from '../src/feedback-loops.js';

// Issue #439: outer caller-level rate gate for slow-band, mirroring the
// #438/#445 pattern for fast-band. Slow-band attempts are ~11s each with a 90s
// baseDelay between retries, so 3 consecutive same-shape failures consume
// ~5 minutes of wall-clock and ~5 minutes of budget. Without an outer gate,
// the loop happily retries the next cycle and the bucket logs 10+ occurrences
// in a 30-min window (observed 2026-05-09T00:08-00:37Z).
//
// Defaults are tuned to the observed cadence: ≥3 same-band failures inside a
// 5-min wall-clock window indicates the upstream isn't time-sensitive and
// "wait 90s" won't help — the caller should short-circuit the lane.
describe('shouldThrottleSlowBandWindow — outer rate gate (#439)', () => {
  const NOW = Date.parse('2026-05-09T01:00:00.000Z');
  const ago = (ms: number) => new Date(NOW - ms).toISOString();

  it('does NOT trip below maxInWindow', () => {
    const recentFailures = [ago(60_000), ago(120_000)];
    expect(
      shouldThrottleSlowBandWindow({
        recentFailures,
        windowMs: 5 * 60_000,
        maxInWindow: 3,
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it('trips at maxInWindow within window', () => {
    const recentFailures = [ago(10_000), ago(60_000), ago(120_000)];
    expect(
      shouldThrottleSlowBandWindow({
        recentFailures,
        windowMs: 5 * 60_000,
        maxInWindow: 3,
        nowMs: NOW,
      }),
    ).toBe(true);
  });

  it('ignores failures outside the window', () => {
    const recentFailures = [
      ago(10_000),
      ago(6 * 60_000), // outside 5-min window
      ago(7 * 60_000),
    ];
    expect(
      shouldThrottleSlowBandWindow({
        recentFailures,
        windowMs: 5 * 60_000,
        maxInWindow: 3,
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it('handles empty list', () => {
    expect(
      shouldThrottleSlowBandWindow({
        recentFailures: [],
        windowMs: 5 * 60_000,
        maxInWindow: 3,
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it('respects KURO_SLOW_BAND_WINDOW_MS / KURO_SLOW_BAND_WINDOW_MAX env overrides', () => {
    const origWindow = process.env.KURO_SLOW_BAND_WINDOW_MS;
    const origMax = process.env.KURO_SLOW_BAND_WINDOW_MAX;
    try {
      process.env.KURO_SLOW_BAND_WINDOW_MS = String(2 * 60_000);
      process.env.KURO_SLOW_BAND_WINDOW_MAX = '2';
      const recentFailures = [ago(10_000), ago(60_000)];
      expect(
        shouldThrottleSlowBandWindow({ recentFailures, nowMs: NOW }),
      ).toBe(true);
      // 2nd is outside the 2-min override window — only 1 inside.
      const recentFailuresOutside = [ago(10_000), ago(3 * 60_000)];
      expect(
        shouldThrottleSlowBandWindow({ recentFailures: recentFailuresOutside, nowMs: NOW }),
      ).toBe(false);
    } finally {
      if (origWindow !== undefined) process.env.KURO_SLOW_BAND_WINDOW_MS = origWindow;
      else delete process.env.KURO_SLOW_BAND_WINDOW_MS;
      if (origMax !== undefined) process.env.KURO_SLOW_BAND_WINDOW_MAX = origMax;
      else delete process.env.KURO_SLOW_BAND_WINDOW_MAX;
    }
  });

  it('skips malformed timestamps without throwing', () => {
    const recentFailures = [
      ago(10_000),
      'not-a-date',
      ago(60_000),
      '',
      ago(120_000),
    ];
    expect(
      shouldThrottleSlowBandWindow({
        recentFailures,
        windowMs: 5 * 60_000,
        maxInWindow: 3,
        nowMs: NOW,
      }),
    ).toBe(true); // 3 valid timestamps inside the window
  });

  it('default thresholds (no env, no args) hold a single same-shape burst <3', () => {
    // Sanity: defaults are KURO_SLOW_BAND_WINDOW_MS=5*60_000, MAX=3.
    // Two same-cycle attempts should not trip; the gate is for cross-cycle waste.
    const recentFailures = [ago(10_000), ago(90_000)];
    expect(shouldThrottleSlowBandWindow({ recentFailures, nowMs: NOW })).toBe(false);
  });
});
