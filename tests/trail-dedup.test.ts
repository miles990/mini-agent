import { describe, it, expect } from 'vitest';
import { deduplicateTrailEntries, TrailEntry } from '../src/memory';

function makeEntry(overrides: Partial<TrailEntry> = {}): TrailEntry {
  return {
    ts: '2026-03-06T10:00:00.000Z',
    agent: 'kuro',
    type: 'focus',
    topics: ['general'],
    detail: 'some action',
    ...overrides,
  };
}

describe('deduplicateTrailEntries', () => {
  it('returns original array when <=3 total entries', () => {
    const entries = [
      makeEntry({ ts: '2026-03-06T10:00:00Z' }),
      makeEntry({ ts: '2026-03-06T10:01:00Z' }),
      makeEntry({ ts: '2026-03-06T10:02:00Z' }),
    ];
    const result = deduplicateTrailEntries(entries);
    expect(result).toBe(entries); // same reference, not a copy
    expect(result).toHaveLength(3);
  });

  it('does not merge entries appearing <=3 times', () => {
    const entries = [
      makeEntry({ ts: '2026-03-06T10:00:00Z', agent: 'kuro', type: 'focus', decision: 'wake' }),
      makeEntry({ ts: '2026-03-06T10:01:00Z', agent: 'kuro', type: 'focus', decision: 'wake' }),
      makeEntry({ ts: '2026-03-06T10:02:00Z', agent: 'kuro', type: 'focus', decision: 'wake' }),
      makeEntry({ ts: '2026-03-06T10:03:00Z', agent: 'mushi', type: 'triage', decision: 'skip' }),
    ];
    const result = deduplicateTrailEntries(entries);
    // 3 kuro+focus+wake (not merged, <=3) + 1 mushi+triage+skip = 4
    expect(result).toHaveLength(4);
    expect(result.every(e => !e.count)).toBe(true);
  });

  it('merges entries with same agent+type+decision pattern >3 times', () => {
    const entries = [
      makeEntry({ ts: '2026-03-06T10:00:00Z', agent: 'mushi', type: 'triage', decision: 'skip', detail: 'heartbeat cycle' }),
      makeEntry({ ts: '2026-03-06T10:05:00Z', agent: 'mushi', type: 'triage', decision: 'skip', detail: 'heartbeat cycle 2' }),
      makeEntry({ ts: '2026-03-06T10:10:00Z', agent: 'mushi', type: 'triage', decision: 'skip', detail: 'heartbeat cycle 3' }),
      makeEntry({ ts: '2026-03-06T10:15:00Z', agent: 'mushi', type: 'triage', decision: 'skip', detail: 'heartbeat cycle 4' }),
    ];
    const result = deduplicateTrailEntries(entries);
    expect(result).toHaveLength(1);
    expect(result[0].count).toBe(4);
    // Uses latest timestamp
    expect(result[0].ts).toBe('2026-03-06T10:15:00Z');
    // Uses first entry's detail
    expect(result[0].detail).toBe('heartbeat cycle');
  });

  it('preserves unique entries in order', () => {
    const entries = [
      makeEntry({ ts: '2026-03-06T10:00:00Z', agent: 'kuro', type: 'focus', decision: 'wake' }),
      makeEntry({ ts: '2026-03-06T10:01:00Z', agent: 'mushi', type: 'triage', decision: 'skip' }),
      makeEntry({ ts: '2026-03-06T10:02:00Z', agent: 'kuro', type: 'focus', decision: 'wake' }),
      makeEntry({ ts: '2026-03-06T10:03:00Z', agent: 'mushi', type: 'triage', decision: 'skip' }),
      makeEntry({ ts: '2026-03-06T10:04:00Z', agent: 'kuro', type: 'scout', detail: 'unique scout' }),
    ];
    const result = deduplicateTrailEntries(entries);
    // kuro+focus+wake: 2 entries (<=3, not merged)
    // mushi+triage+skip: 2 entries (<=3, not merged)
    // kuro+scout: 1 entry (<=3, not merged)
    expect(result).toHaveLength(5);
    // Order preserved: kuro+focus group first, then mushi+triage, then kuro+scout
    expect(result[0].agent).toBe('kuro');
    expect(result[0].type).toBe('focus');
    expect(result[1].agent).toBe('kuro');
    expect(result[1].type).toBe('focus');
    expect(result[2].agent).toBe('mushi');
    expect(result[2].type).toBe('triage');
    expect(result[3].agent).toBe('mushi');
    expect(result[3].type).toBe('triage');
    expect(result[4].agent).toBe('kuro');
    expect(result[4].type).toBe('scout');
  });

  it('merged entry uses latest timestamp and combined topics', () => {
    const entries = [
      makeEntry({ ts: '2026-03-06T10:00:00Z', agent: 'mushi', type: 'triage', decision: 'skip', topics: ['heartbeat'] }),
      makeEntry({ ts: '2026-03-06T10:05:00Z', agent: 'mushi', type: 'triage', decision: 'skip', topics: ['workspace'] }),
      makeEntry({ ts: '2026-03-06T10:10:00Z', agent: 'mushi', type: 'triage', decision: 'skip', topics: ['heartbeat'] }),
      makeEntry({ ts: '2026-03-06T10:15:00Z', agent: 'mushi', type: 'triage', decision: 'skip', topics: ['cron'] }),
    ];
    const result = deduplicateTrailEntries(entries);
    expect(result).toHaveLength(1);
    expect(result[0].ts).toBe('2026-03-06T10:15:00Z');
    expect(result[0].count).toBe(4);
    // Combined and deduplicated topics
    expect(result[0].topics).toEqual(expect.arrayContaining(['heartbeat', 'workspace', 'cron']));
    expect(result[0].topics).toHaveLength(3); // heartbeat deduped
  });

  it('handles mixed merged and unmerged groups', () => {
    const entries = [
      // 5x mushi triage skip -> should merge
      makeEntry({ ts: '2026-03-06T10:00:00Z', agent: 'mushi', type: 'triage', decision: 'skip', detail: 'heartbeat idle' }),
      makeEntry({ ts: '2026-03-06T10:01:00Z', agent: 'mushi', type: 'triage', decision: 'skip', detail: 'heartbeat idle 2' }),
      makeEntry({ ts: '2026-03-06T10:02:00Z', agent: 'mushi', type: 'triage', decision: 'skip', detail: 'heartbeat idle 3' }),
      makeEntry({ ts: '2026-03-06T10:03:00Z', agent: 'mushi', type: 'triage', decision: 'skip', detail: 'heartbeat idle 4' }),
      makeEntry({ ts: '2026-03-06T10:04:00Z', agent: 'mushi', type: 'triage', decision: 'skip', detail: 'heartbeat idle 5' }),
      // 2x kuro focus wake -> should NOT merge
      makeEntry({ ts: '2026-03-06T10:05:00Z', agent: 'kuro', type: 'focus', decision: 'wake', detail: 'processing inbox' }),
      makeEntry({ ts: '2026-03-06T10:06:00Z', agent: 'kuro', type: 'focus', decision: 'wake', detail: 'processing task' }),
      // 1x unique
      makeEntry({ ts: '2026-03-06T10:07:00Z', agent: 'kuro', type: 'scout', detail: 'exploring new topic' }),
    ];
    const result = deduplicateTrailEntries(entries);
    // 1 merged mushi + 2 unmerged kuro focus + 1 unique kuro scout = 4
    expect(result).toHaveLength(4);
    expect(result[0].agent).toBe('mushi');
    expect(result[0].count).toBe(5);
    expect(result[0].detail).toBe('heartbeat idle'); // first entry's detail
    expect(result[1].agent).toBe('kuro');
    expect(result[1].type).toBe('focus');
    expect(result[1].count).toBeUndefined();
    expect(result[2].agent).toBe('kuro');
    expect(result[2].type).toBe('focus');
    expect(result[3].agent).toBe('kuro');
    expect(result[3].type).toBe('scout');
  });

  it('treats different decisions as different patterns', () => {
    const entries = [
      makeEntry({ ts: '2026-03-06T10:00:00Z', agent: 'mushi', type: 'triage', decision: 'skip' }),
      makeEntry({ ts: '2026-03-06T10:01:00Z', agent: 'mushi', type: 'triage', decision: 'skip' }),
      makeEntry({ ts: '2026-03-06T10:02:00Z', agent: 'mushi', type: 'triage', decision: 'skip' }),
      makeEntry({ ts: '2026-03-06T10:03:00Z', agent: 'mushi', type: 'triage', decision: 'skip' }),
      makeEntry({ ts: '2026-03-06T10:04:00Z', agent: 'mushi', type: 'triage', decision: 'wake' }),
      makeEntry({ ts: '2026-03-06T10:05:00Z', agent: 'mushi', type: 'triage', decision: 'wake' }),
    ];
    const result = deduplicateTrailEntries(entries);
    // 4x skip merged to 1, 2x wake kept as-is = 3
    expect(result).toHaveLength(3);
    expect(result[0].decision).toBe('skip');
    expect(result[0].count).toBe(4);
    expect(result[1].decision).toBe('wake');
    expect(result[1].count).toBeUndefined();
    expect(result[2].decision).toBe('wake');
    expect(result[2].count).toBeUndefined();
  });

  it('handles empty array', () => {
    const result = deduplicateTrailEntries([]);
    expect(result).toEqual([]);
  });
});
