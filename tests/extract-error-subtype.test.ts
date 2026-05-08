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

describe('extractErrorSubtype — silent_exit_void 4-class typed-failure schema (#370 + arxiv 2605.05724)', () => {
  // Format from agent.ts:249 + extractErrorSubtype regex:
  //   "CLI 靜默中斷（exit N/A，{durSec}s 無 stderr）. stdout=empty"
  //   plus appended " prompt {N} chars" so promptMatch picks it up.
  const mkSilentMsg = (durSec: number, promptChars: number) =>
    `CLI 靜默中斷（exit N/A，${durSec}s 無 stderr）. stdout=empty prompt ${promptChars} chars`;

  it('routes >=800s HTTP-stall to silent_exit_void_http (#191 budget-overrun class)', () => {
    expect(extractErrorSubtype(mkSilentMsg(970, 14000))).toBe('silent_exit_void_http');
    expect(extractErrorSubtype(mkSilentMsg(1007, 16000))).toBe('silent_exit_void_http');
  });

  it('routes >=35K prompt to silent_exit_void_40k (#233 size-fail class)', () => {
    expect(extractErrorSubtype(mkSilentMsg(357, 35000))).toBe('silent_exit_void_40k');
    expect(extractErrorSubtype(mkSilentMsg(450, 42000))).toBe('silent_exit_void_40k');
  });

  it('routes 20-35K prompt + 300-799s duration to silent_exit_void_midprompt (#370 first-token stall)', () => {
    // Observed cluster: 24K @ 365s, count=10 on instance 03bbc29a 2026-05-08
    expect(extractErrorSubtype(mkSilentMsg(365, 24419))).toBe('silent_exit_void_midprompt');
    expect(extractErrorSubtype(mkSilentMsg(300, 20000))).toBe('silent_exit_void_midprompt');
    expect(extractErrorSubtype(mkSilentMsg(799, 34999))).toBe('silent_exit_void_midprompt');
  });

  it('keeps short-duration mid-size cluster on silent_exit_void baseline (#77 crash-class)', () => {
    // #77 baseline: prompt 22-25K @ ~260s — must NOT promote to midprompt
    expect(extractErrorSubtype(mkSilentMsg(260, 22000))).toBe('silent_exit_void');
    expect(extractErrorSubtype(mkSilentMsg(260, 25000))).toBe('silent_exit_void');
    expect(extractErrorSubtype(mkSilentMsg(299, 24000))).toBe('silent_exit_void');
  });

  it('keeps tiny-prompt cases on silent_exit_void baseline regardless of duration', () => {
    expect(extractErrorSubtype(mkSilentMsg(500, 10000))).toBe('silent_exit_void');
    expect(extractErrorSubtype(mkSilentMsg(150, 5000))).toBe('silent_exit_void');
  });
});

describe('extractErrorSubtype — budget_exceeded and user_abort (#370 misclassification fix)', () => {
  // Real forensic messages: agent.ts appends stderr AFTER the 靜默中斷 prefix.
  // These must be caught BEFORE the silent_exit_void subclassification block.
  const mkBudgetMsg = (durSec: number, promptChars: number) =>
    `CLI 靜默中斷（exit N/A，${durSec}s 無 stderr）. stdout=empty prompt ${promptChars} chars stderr: Claude Code returned an error result: Reached maximum budget ($5)`;

  const mkAbortMsg = (durSec: number) =>
    `CLI 靜默中斷（exit N/A，${durSec}s 無 stderr）. stdout=empty stderr: Claude Code process aborted by user`;

  it('classifies budget-cap exit as budget_exceeded (not silent_exit_void_midprompt)', () => {
    // The observed cluster: 24K prompt @ 365s with budget stderr — was mislabeled
    expect(extractErrorSubtype(mkBudgetMsg(365, 24419))).toBe('budget_exceeded');
    expect(extractErrorSubtype(mkBudgetMsg(327, 20000))).toBe('budget_exceeded');
    expect(extractErrorSubtype(mkBudgetMsg(429, 25000))).toBe('budget_exceeded');
  });

  it('classifies user-abort exit as user_abort', () => {
    expect(extractErrorSubtype(mkAbortMsg(365))).toBe('user_abort');
    expect(extractErrorSubtype(mkAbortMsg(100))).toBe('user_abort');
  });

  it('budget_exceeded message without silent-exit prefix is still classified correctly', () => {
    expect(extractErrorSubtype('Reached maximum budget ($5)')).toBe('budget_exceeded');
    expect(extractErrorSubtype('Claude Code returned an error result: Reached maximum budget ($5)')).toBe('budget_exceeded');
  });

  it('silent_exit_void_midprompt still works for genuine first-token stalls (no budget message)', () => {
    // mkSilentMsg (no budget text) should still route to midprompt
    const genuineStall = `CLI 靜默中斷（exit N/A，365s 無 stderr）. stdout=empty prompt 24419 chars`;
    expect(extractErrorSubtype(genuineStall)).toBe('silent_exit_void_midprompt');
  });
});
