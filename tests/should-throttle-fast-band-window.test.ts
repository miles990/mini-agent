import { describe, it, expect } from 'vitest';
import { shouldThrottleFastBandWindow } from '../src/feedback-loops.js';

// Issue #438: outer caller-level rate gate. PR #339's per-call breaker stops
// in-call exp-backoff but does not throttle the loop, so a 30-60min upstream
// outage produces 20+ separate fast-band occurrences (1 per cycle). This gate
// is checked by the caller BEFORE invoking callClaude on fast-band-prone paths.
describe('shouldThrottleFastBandWindow — outer rate gate (#438)', () => {
  const NOW = Date.parse('2026-05-09T01:00:00.000Z');
  const ago = (ms: number) => new Date(NOW - ms).toISOString();

  it('does NOT trip below maxInWindow', () => {
    const recentFailures = [ago(60_000), ago(120_000), ago(180_000)];
    expect(
      shouldThrottleFastBandWindow({
        recentFailures,
        windowMs: 5 * 60_000,
        maxInWindow: 5,
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it('trips at maxInWindow within window', () => {
    const recentFailures = [
      ago(10_000),
      ago(60_000),
      ago(120_000),
      ago(180_000),
      ago(240_000),
    ];
    expect(
      shouldThrottleFastBandWindow({
        recentFailures,
        windowMs: 5 * 60_000,
        maxInWindow: 5,
        nowMs: NOW,
      }),
    ).toBe(true);
  });

  it('ignores failures outside the window', () => {
    const recentFailures = [
      ago(10_000),
      ago(60_000),
      ago(6 * 60_000), // outside 5-min window
      ago(7 * 60_000),
      ago(8 * 60_000),
    ];
    expect(
      shouldThrottleFastBandWindow({
        recentFailures,
        windowMs: 5 * 60_000,
        maxInWindow: 5,
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it('handles empty list', () => {
    expect(
      shouldThrottleFastBandWindow({
        recentFailures: [],
        windowMs: 5 * 60_000,
        maxInWindow: 5,
        nowMs: NOW,
      }),
    ).toBe(false);
  });

  it('respects KURO_FAST_BAND_WINDOW_MS / KURO_FAST_BAND_WINDOW_MAX env overrides', () => {
    const origWindow = process.env.KURO_FAST_BAND_WINDOW_MS;
    const origMax = process.env.KURO_FAST_BAND_WINDOW_MAX;
    try {
      process.env.KURO_FAST_BAND_WINDOW_MS = String(2 * 60_000);
      process.env.KURO_FAST_BAND_WINDOW_MAX = '3';
      const recentFailures = [ago(10_000), ago(60_000), ago(90_000)];
      expect(
        shouldThrottleFastBandWindow({ recentFailures, nowMs: NOW }),
      ).toBe(true);
      // 4th & 5th outside the 2-min override window — only 2 inside.
      const recentFailuresOutside = [
        ago(10_000),
        ago(60_000),
        ago(3 * 60_000),
      ];
      expect(
        shouldThrottleFastBandWindow({ recentFailures: recentFailuresOutside, nowMs: NOW }),
      ).toBe(false);
    } finally {
      if (origWindow !== undefined) process.env.KURO_FAST_BAND_WINDOW_MS = origWindow;
      else delete process.env.KURO_FAST_BAND_WINDOW_MS;
      if (origMax !== undefined) process.env.KURO_FAST_BAND_WINDOW_MAX = origMax;
      else delete process.env.KURO_FAST_BAND_WINDOW_MAX;
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
      shouldThrottleFastBandWindow({
        recentFailures,
        windowMs: 5 * 60_000,
        maxInWindow: 5,
        nowMs: NOW,
      }),
    ).toBe(false);
  });
});
