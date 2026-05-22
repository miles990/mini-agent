import { describe, expect, it } from 'vitest';
import { isLiveErrorPatternResolved } from '../src/pulse.js';

describe('pulse error-pattern task gating', () => {
  it('treats a bucket as resolved when lastSeenAt is not after resolvedAt', () => {
    expect(isLiveErrorPatternResolved({
      resolvedAt: '2026-05-22T00:07:51.000Z',
      lastSeenAt: '2026-05-22T00:07:50.000Z',
    })).toBe(true);
  });

  it('does not suppress a bucket that re-fired after resolvedAt', () => {
    expect(isLiveErrorPatternResolved({
      resolvedAt: '2026-05-22T00:07:51.000Z',
      lastSeenAt: '2026-05-22T00:07:52.000Z',
    })).toBe(false);
  });

  it('uses lastSeen day granularity for legacy buckets', () => {
    expect(isLiveErrorPatternResolved({
      resolvedAt: '2026-05-22T00:07:51.000Z',
      lastSeen: '2026-05-22',
    })).toBe(true);
  });
});
