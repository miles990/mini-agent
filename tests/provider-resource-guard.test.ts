import { describe, expect, it } from 'vitest';
import { classifyProviderResourceHold } from '../src/provider-resource-guard.js';

describe('provider resource guard', () => {
  it('classifies Claude usage exhaustion with reset time', () => {
    const result = classifyProviderResourceHold(
      "Claude Code returned an error result: You're out of extra usage · resets 2:40am (Asia/Taipei)",
      new Date('2026-05-06T16:30:00.000Z'),
    );

    expect(result).toEqual(expect.objectContaining({
      type: 'provider-quota',
      provider: 'claude',
      resumeAt: '2026-05-06T18:40:00.000Z',
    }));
  });

  it('uses a conservative one-hour hold when no reset time is present', () => {
    const result = classifyProviderResourceHold(
      'provider failed: rate_limit quota exceeded',
      new Date('2026-05-06T16:30:00.000Z'),
    );

    expect(result).toEqual(expect.objectContaining({
      type: 'provider-quota',
      provider: 'unknown',
      resumeAt: '2026-05-06T17:30:00.000Z',
    }));
  });

  it('ignores normal command failures', () => {
    expect(classifyProviderResourceHold('Shell error: Command exited 1')).toBeNull();
  });
});
