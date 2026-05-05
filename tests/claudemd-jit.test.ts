import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetClaudeMdJITForTests,
  getKGAugmentedContext,
} from '../src/claudemd-jit.js';

describe('CLAUDE.md JIT KG augmentation', () => {
  beforeEach(() => {
    __resetClaudeMdJITForTests();
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith('/api/stats')) {
        return jsonResponse({ nodes_by_namespace: { kuro: 200 } });
      }
      if (href.endsWith('/api/query')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { namespace?: string };
        return jsonResponse({
          formatted_text: `${body.namespace ?? 'unknown'} context\n`,
          token_count: 10,
        });
      }
      return jsonResponse({}, false);
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetClaudeMdJITForTests();
  });

  it('caches KG context by normalized hint', async () => {
    const first = await getKGAugmentedContext('  Memory   DAG  ');
    const second = await getKGAugmentedContext('memory dag');

    expect(first).toContain('kuro context');
    expect(first).toContain('shared context');
    expect(second).toBe(first);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3); // stats + kuro query + shared query
  });

  it('shares in-flight KG queries for identical hints', async () => {
    const [first, second] = await Promise.all([
      getKGAugmentedContext('provider claims'),
      getKGAugmentedContext('provider claims'),
    ]);

    expect(second).toBe(first);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
  });
});

function jsonResponse(data: unknown, ok = true): Response {
  return {
    ok,
    json: async () => data,
  } as Response;
}
