import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetContinuityContextCacheForTests,
  buildContinuityContext,
} from '../src/kg-continuity.js';
import {
  __resetKGDiscussionsContextCacheForTests,
  buildKGDiscussionsContext,
  markDiscussionDirty,
} from '../src/kg-discussions.js';

describe('KG context cache', () => {
  beforeEach(() => {
    __resetContinuityContextCacheForTests();
    __resetKGDiscussionsContextCacheForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    __resetContinuityContextCacheForTests();
    __resetKGDiscussionsContextCacheForTests();
  });

  it('caches continuity context for repeated buildContext calls', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      results: [{
        node: {
          name: 'cycle-1',
          created_at: '2026-05-05T00:00:00.000Z',
          properties: {
            section_type: 'cycle-state',
            id: 'cycle-1',
            focus: 'KG optimization',
            intent: 'reduce blocking context reads',
            outcome: 'progressed',
            artifacts: ['commit:test'],
            closes: [],
            intentHash: 'abc',
            ts: '2026-05-05T00:00:00.000Z',
          },
        },
      }],
    })));

    const first = await buildContinuityContext();
    const second = await buildContinuityContext();

    expect(first).toContain('KG optimization');
    expect(second).toBe(first);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('shares in-flight continuity reads', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ results: [] })));

    await Promise.all([
      buildContinuityContext(),
      buildContinuityContext(),
    ]);

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('returns stale continuity context when refresh fails after TTL', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      results: [{
        node: {
          name: 'cycle-1',
          created_at: '2026-05-05T00:00:00.000Z',
          properties: {
            section_type: 'cycle-state',
            id: 'cycle-1',
            focus: 'stale continuity',
            intent: 'survive KG outage',
            outcome: 'progressed',
            artifacts: [],
            closes: [],
            intentHash: 'abc',
            ts: '2026-05-05T00:00:00.000Z',
          },
        },
      }],
    })));

    const first = await buildContinuityContext();
    expect(first).toContain('stale continuity');

    vi.mocked(fetch).mockRejectedValue(new Error('KG offline'));
    vi.advanceTimersByTime(30_001);

    const stale = await buildContinuityContext();
    expect(stale).toBe(first);
  });

  it('caches clean KG discussions and invalidates on dirty webhook', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.includes('/api/discussion/disc-1')) {
        return jsonResponse({
          positions: [{
            node_id: 'pos-1',
            source_agent: 'akari',
            description: 'fresh counterpoint',
            confidence: 0.9,
            relation: 'responds_to',
            created_at: '2026-05-05T00:00:00.000Z',
          }],
        });
      }
      return jsonResponse({
        discussions: [{
          id: 'disc-1',
          topic: 'multi-brain KG sharing',
          status: 'active',
          participants: ['kuro', 'akari'],
          position_count: 3,
          updated_at: '2026-05-05T00:00:00.000Z',
        }],
      });
    }));

    const clean = await buildKGDiscussionsContext();
    const cached = await buildKGDiscussionsContext();
    expect(cached).toBe(clean);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);

    markDiscussionDirty('disc-1');
    const dirty = await buildKGDiscussionsContext();
    expect(dirty).toContain('NEW');
    expect(dirty).toContain('fresh counterpoint');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);

    const cleanAgain = await buildKGDiscussionsContext();
    expect(cleanAgain).not.toContain('NEW');
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(4);
  });

  it('returns stale discussion context when refresh fails after TTL', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      discussions: [{
        id: 'disc-1',
        topic: 'stale discussions',
        status: 'active',
        participants: ['kuro'],
        position_count: 1,
        updated_at: '2026-05-05T00:00:00.000Z',
      }],
    })));

    const first = await buildKGDiscussionsContext();
    expect(first).toContain('stale discussions');

    vi.mocked(fetch).mockRejectedValue(new Error('KG offline'));
    vi.advanceTimersByTime(15_001);

    const stale = await buildKGDiscussionsContext();
    expect(stale).toBe(first);
  });
});

function jsonResponse(data: unknown, ok = true): Response {
  return {
    ok,
    json: async () => data,
  } as Response;
}
