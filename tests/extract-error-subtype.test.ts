import { describe, it, expect } from 'vitest';
import { extractErrorSubtype } from '../src/feedback-loops.js';

describe('extractErrorSubtype — transient band split (#318)', () => {
  // Sample error message format observed in error-patterns.json:
  //   "[8s] 處理訊息時發生錯誤... attempt 2/3, prompt 26866 chars, dur=8s"
  // The classifier looks at lower-cased message + dur=Xs suffix.
  const mkMsg = (durSec: number) =>
    `[${durSec}s] 處理訊息時發生錯誤 attempt 2/3, prompt 12345 chars, dur=${durSec}s`;

  it('classifies dur<10s as transient_fast_band', () => {
    expect(extractErrorSubtype(mkMsg(1))).toBe('transient_fast_band');
    expect(extractErrorSubtype(mkMsg(8))).toBe('transient_fast_band');
    expect(extractErrorSubtype(mkMsg(9))).toBe('transient_fast_band');
  });

  it('classifies dur 10-59s as transient_slow_band', () => {
    expect(extractErrorSubtype(mkMsg(10))).toBe('transient_slow_band');
    expect(extractErrorSubtype(mkMsg(19))).toBe('transient_slow_band');
    expect(extractErrorSubtype(mkMsg(59))).toBe('transient_slow_band');
  });

  it('keeps dur 60-599s as midband_no_diag (untouched by #318)', () => {
    expect(extractErrorSubtype(mkMsg(60))).toBe('midband_no_diag');
    expect(extractErrorSubtype(mkMsg(300))).toBe('midband_no_diag');
    expect(extractErrorSubtype(mkMsg(599))).toBe('midband_no_diag');
  });

  it('keeps dur>=600s as hang_no_diag (untouched by #318)', () => {
    expect(extractErrorSubtype(mkMsg(600))).toBe('hang_no_diag');
    expect(extractErrorSubtype(mkMsg(900))).toBe('hang_no_diag');
  });

  it('falls back to no_diag when no dur= suffix present', () => {
    const msg = '處理訊息時發生錯誤 some other text without duration';
    expect(extractErrorSubtype(msg)).toBe('no_diag');
  });
});
