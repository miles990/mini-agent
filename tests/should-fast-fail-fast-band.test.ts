import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { shouldFastFailFastBand } from '../src/feedback-loops.js';

// Issue #333: circuit-breaker gate for transient_fast_band errors.
// Fast-band = API errored back in <10s; sleeping 90s+ between retries is wasted
// budget because the upstream rejection is deterministic. Gate fails fast on
// attempt 0 only, so existing exp-backoff still applies to slow-band/no_diag.
describe('shouldFastFailFastBand — circuit-breaker gate (#333)', () => {
  // Mirrors the message shape extractErrorSubtype keys off (處理訊息時發生錯誤 + dur=Xs).
  const mkMsg = (durSec: number) =>
    `[${durSec}s] 處理訊息時發生錯誤 attempt 1/3, prompt 26866 chars, dur=${durSec}s`;

  const origEnv = process.env.KURO_FAST_FAIL_THRESHOLD_MS;
  beforeEach(() => {
    delete process.env.KURO_FAST_FAIL_THRESHOLD_MS;
  });
  afterEach(() => {
    if (origEnv !== undefined) process.env.KURO_FAST_FAIL_THRESHOLD_MS = origEnv;
    else delete process.env.KURO_FAST_FAIL_THRESHOLD_MS;
  });

  it('trips on first attempt fast-band error', () => {
    expect(
      shouldFastFailFastBand({
        attempt: 0,
        attemptDurationMs: 8_000,
        errorMsg: mkMsg(8),
      }),
    ).toBe(true);
  });

  it('does NOT trip on retry attempts even if fast-band', () => {
    // Once we're past attempt 0 the retry budget is already committed; let the
    // existing path run so the sample frame shows up in error-patterns.
    expect(
      shouldFastFailFastBand({
        attempt: 1,
        attemptDurationMs: 8_000,
        errorMsg: mkMsg(8),
      }),
    ).toBe(false);
  });

  it('does NOT trip when attempt duration crosses the 10s threshold', () => {
    expect(
      shouldFastFailFastBand({
        attempt: 0,
        attemptDurationMs: 12_000,
        errorMsg: mkMsg(12),
      }),
    ).toBe(false);
  });

  it('does NOT trip on slow-band subtype', () => {
    expect(
      shouldFastFailFastBand({
        attempt: 0,
        attemptDurationMs: 8_000,
        errorMsg: mkMsg(15), // slow-band by classifier
      }),
    ).toBe(false);
  });

  it('does NOT trip on unrelated subtypes (dns / sigterm)', () => {
    expect(
      shouldFastFailFastBand({
        attempt: 0,
        attemptDurationMs: 5_000,
        errorMsg: 'getaddrinfo ENOTFOUND api.anthropic.com',
      }),
    ).toBe(false);
    expect(
      shouldFastFailFastBand({
        attempt: 0,
        attemptDurationMs: 5_000,
        errorMsg: 'exit 143 sigterm reason=preempt',
      }),
    ).toBe(false);
  });

  it('respects KURO_FAST_FAIL_THRESHOLD_MS env override', () => {
    process.env.KURO_FAST_FAIL_THRESHOLD_MS = '5000';
    // 8s would trip default 10s threshold but is above 5s override.
    expect(
      shouldFastFailFastBand({
        attempt: 0,
        attemptDurationMs: 8_000,
        errorMsg: mkMsg(8),
      }),
    ).toBe(false);
    // 4s below override threshold trips.
    expect(
      shouldFastFailFastBand({
        attempt: 0,
        attemptDurationMs: 4_000,
        errorMsg: mkMsg(4),
      }),
    ).toBe(true);
  });

  it('explicit thresholdMs argument wins over env', () => {
    process.env.KURO_FAST_FAIL_THRESHOLD_MS = '5000';
    expect(
      shouldFastFailFastBand({
        attempt: 0,
        attemptDurationMs: 6_000,
        errorMsg: mkMsg(6),
        thresholdMs: 8_000,
      }),
    ).toBe(true);
  });
});
