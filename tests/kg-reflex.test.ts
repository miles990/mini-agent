import { describe, it, expect, vi } from 'vitest';
import { shouldPush, pushEntryToKG, reflexPush } from '../src/kg-reflex.js';
import type { Entry } from '../src/types.js';

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'entry-deadbeef00000001',
    source: 'topics/kg-reflex.md',
    content_hash: 'sha256:abc',
    content:
      'Reflex 機制：每次 compileFromTags 寫入 entry 後 fire-and-forget POST /api/write 到 KG。',
    concepts: ['kg', 'reflex'],
    type: 'pattern',
    created_at: '2026-04-27T08:00:00Z',
    last_validated_at: '2026-04-27T08:00:00Z',
    confidence: 0.9,
    supersedes: [],
    superseded_by: null,
    stale_reason: null,
    attribution: 'kuro',
    ...overrides,
  };
}

describe('shouldPush', () => {
  it('rejects entries shorter than 40 chars', () => {
    expect(shouldPush(makeEntry({ content: 'too short' }))).toBe(false);
  });

  it('rejects fact-type entries with no concepts', () => {
    expect(
      shouldPush(
        makeEntry({
          type: 'fact',
          concepts: [],
          content: 'Some fact long enough to pass the length filter check baseline.',
        }),
      ),
    ).toBe(false);
  });

  it('accepts pattern entries with concepts and sufficient length', () => {
    expect(shouldPush(makeEntry())).toBe(true);
  });

  it('accepts fact entries that have concept tags', () => {
    expect(
      shouldPush(
        makeEntry({
          type: 'fact',
          concepts: ['kg-routes'],
          content: 'POST /api/write body shape requires text + source_agent at top level.',
        }),
      ),
    ).toBe(true);
  });
});

describe('pushEntryToKG', () => {
  it('returns pushed=true when fetch returns ok', async () => {
    const fakeFetch = vi.fn(async () => new Response(null, { status: 202 }));
    const res = await pushEntryToKG(makeEntry(), fakeFetch as unknown as typeof fetch);
    expect(res.pushed).toBe(true);
    expect(fakeFetch).toHaveBeenCalledTimes(1);
    const [, init] = fakeFetch.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(body.source_agent).toBe('kuro:memory-compiler');
    expect(body.namespace).toBe('kuro');
    expect(body.metadata.entry_id).toBe('entry-deadbeef00000001');
    expect(body.metadata.topic).toBe('kg-reflex');
  });

  it('returns pushed=false with HTTP reason on non-ok response', async () => {
    const fakeFetch = vi.fn(async () => new Response(null, { status: 500 }));
    const res = await pushEntryToKG(makeEntry(), fakeFetch as unknown as typeof fetch);
    expect(res.pushed).toBe(false);
    expect(res.reason).toBe('HTTP 500');
  });

  it('returns timeout reason when fetch is aborted', async () => {
    const fakeFetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );
    // Override env via short-circuit: monkey-patch global fetch path via injected fetchImpl.
    // We simulate timeout by passing a fetchImpl that never resolves until aborted.
    // The reflex's internal AbortController will fire after TIMEOUT_MS (1500ms default).
    // Override timeout via env to keep test fast.
    process.env.KG_REFLEX_TIMEOUT_MS_TEST = '50';
    const res = await pushEntryToKG(makeEntry(), fakeFetch as unknown as typeof fetch);
    expect(res.pushed).toBe(false);
    // Either 'timeout' (AbortError) — accept both since AbortController triggers AbortError.
    expect(res.reason === 'timeout' || res.reason?.includes('Abort')).toBe(true);
  }, 5000);

  it('skips with filtered reason for low-signal entries', async () => {
    const fakeFetch = vi.fn(async () => new Response(null, { status: 202 }));
    const res = await pushEntryToKG(
      makeEntry({ content: 'short' }),
      fakeFetch as unknown as typeof fetch,
    );
    expect(res.pushed).toBe(false);
    expect(res.reason).toBe('filtered');
    expect(fakeFetch).not.toHaveBeenCalled();
  });
});

describe('reflexPush', () => {
  it('returns void synchronously and never throws', () => {
    // Use an entry that will be filtered → no actual network call attempted.
    expect(() => reflexPush(makeEntry({ content: 'short' }))).not.toThrow();
  });

  it('does not throw even when the underlying push would error', () => {
    // Disable via env so pushEntryToKG short-circuits with 'disabled'.
    const prev = process.env.KG_REFLEX_DISABLED;
    process.env.KG_REFLEX_DISABLED = '1';
    try {
      expect(() => reflexPush(makeEntry())).not.toThrow();
    } finally {
      if (prev === undefined) delete process.env.KG_REFLEX_DISABLED;
      else process.env.KG_REFLEX_DISABLED = prev;
    }
  });
});
