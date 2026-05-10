import { describe, it, expect } from 'vitest';
import { extractErrorSubtype, PROTECTIVE_SUBTYPES } from '../src/feedback-loops.js';

// Issue #491: Split transient_fast_band classifier — extract upstream_quickreject_cn
// for Chinese-localized 400 errors so they stop polluting transient_fast_band telemetry.
//
// Signature of upstream_quickreject_cn:
//   - Message contains 處理訊息時發生錯誤 OR 請稍後再試
//   - dur < 20s (durMs < 20_000 means dur=0..19s from the dur=Xs suffix)
//   - Message contains "exit N/A"
//
// The smoking-gun case from the issue:
//   2026-05-09T19:54:41.869Z — attempt 1/3, total 8100ms, loop lane, 36402 chars
//   "exit N/A" present, dur<20s, fires BEFORE any retry window accumulates.

describe('extractErrorSubtype — upstream_quickreject_cn split (#491)', () => {
  // Canonical upstream quickreject message shape observed in error-patterns.json
  const mkQuickrejectMsg = (durSec: number, attempt = 1) =>
    `處理訊息時發生錯誤 [dur=${durSec}s] attempt ${attempt}/3, exit N/A, dur=${durSec}s`;

  it('classifies dur<20s + exit N/A as upstream_quickreject_cn (smoking-gun case)', () => {
    // 2026-05-09T19:54:41.869Z: attempt 1/3, 8s, exit N/A
    expect(extractErrorSubtype(mkQuickrejectMsg(8, 1))).toBe('upstream_quickreject_cn');
  });

  it('classifies dur=0s + exit N/A as upstream_quickreject_cn', () => {
    expect(extractErrorSubtype(mkQuickrejectMsg(0, 1))).toBe('upstream_quickreject_cn');
  });

  it('classifies dur=19s + exit N/A as upstream_quickreject_cn (boundary)', () => {
    expect(extractErrorSubtype(mkQuickrejectMsg(19, 1))).toBe('upstream_quickreject_cn');
  });

  it('does NOT classify dur=20s + exit N/A as upstream_quickreject_cn (boundary — falls to fast-band)', () => {
    // dur=20s is above the <20s threshold, should fall through to transient_fast_band
    expect(extractErrorSubtype(mkQuickrejectMsg(20, 1))).toBe('transient_slow_band');
  });

  it('classifies 請稍後再試 variant + exit N/A + dur<20s as upstream_quickreject_cn', () => {
    const msg = '請稍後再試 attempt 1/3, exit N/A, dur=5s';
    expect(extractErrorSubtype(msg)).toBe('upstream_quickreject_cn');
  });

  it('does NOT classify 處理訊息時發生錯誤 without exit N/A as upstream_quickreject_cn', () => {
    // Without exit N/A, should fall to transient_fast_band (dur<10s)
    const msg = '處理訊息時發生錯誤 attempt 2/3, dur=8s';
    expect(extractErrorSubtype(msg)).toBe('transient_fast_band');
  });

  it('does NOT classify exit N/A without Chinese localized message as upstream_quickreject_cn', () => {
    // Generic message with exit N/A but no Chinese localized phrase
    const msg = 'UNKNOWN error attempt 2/3, exit N/A, dur=8s';
    // Should not match — no 處理訊息時發生錯誤 or 請稍後再試
    expect(extractErrorSubtype(msg)).not.toBe('upstream_quickreject_cn');
  });

  it('upstream_quickreject_cn is in PROTECTIVE_SUBTYPES (cannot gate it, re-fire must not count as regression)', () => {
    expect(PROTECTIVE_SUBTYPES.has('upstream_quickreject_cn')).toBe(true);
  });

  it('existing transient_fast_band classification still works when exit N/A is absent', () => {
    // The retry-storm flavor: no exit N/A, dur<10s
    const msg = '處理訊息時發生錯誤 attempt 3/3, prompt 26866 chars, dur=8s';
    expect(extractErrorSubtype(msg)).toBe('transient_fast_band');
  });

  it('existing transient_slow_band classification still works when exit N/A is absent', () => {
    const msg = '處理訊息時發生錯誤 attempt 2/3, prompt 12345 chars, dur=15s';
    expect(extractErrorSubtype(msg)).toBe('transient_slow_band');
  });

  it('classifies attempt=1 case identically to attempt=3 (caller-gate cannot prevent attempt-1)', () => {
    // The key insight: attempt 1/3 means there is no prior call for the fast-band
    // window to throttle — structural incapability of the existing gate.
    // Both attempts must produce the same upstream_quickreject_cn label.
    expect(extractErrorSubtype(mkQuickrejectMsg(8, 1))).toBe('upstream_quickreject_cn');
    expect(extractErrorSubtype(mkQuickrejectMsg(8, 3))).toBe('upstream_quickreject_cn');
  });
});
