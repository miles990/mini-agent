// @ts-nocheck
import { describe, expect, it, vi } from 'vitest';
import { extractTakeUrls, checkUrlLiveness } from '../scripts/build-kuro-content.mjs';

describe('build-kuro-content URL liveness (#436)', () => {
  describe('extractTakeUrls', () => {
    it('returns empty for missing kuro-take section', () => {
      expect(extractTakeUrls('## other\n[a](https://x.com)')).toEqual([]);
    });
    it('extracts http(s) urls from kuro-take only', () => {
      const c = `## kuro-take\nfoo [a](https://example.com/a) bar [b](http://x.io)\n## next\n[c](https://nope.com)`;
      expect(extractTakeUrls(c)).toEqual(['https://example.com/a', 'http://x.io']);
    });
    it('skips relative/non-http links', () => {
      const c = `## kuro-take\n[rel](/foo) [mailto](mailto:x@y) [ok](https://ok.com)`;
      expect(extractTakeUrls(c)).toEqual(['https://ok.com']);
    });
  });

  describe('checkUrlLiveness', () => {
    function mkFetch(table: Record<string, { HEAD?: number; GET?: number; throws?: string }>) {
      return vi.fn(async (url: string, opts: any) => {
        const entry = table[url];
        if (!entry) throw new Error('unmocked url ' + url);
        if (entry.throws) { const e: any = new Error(entry.throws); e.name = entry.throws === 'timeout' ? 'AbortError' : 'TypeError'; throw e; }
        const status = opts.method === 'HEAD' ? entry.HEAD : entry.GET;
        if (status == null) throw new Error('no status for ' + opts.method);
        return { status } as any;
      });
    }

    it('passes when all HEADs return 200', async () => {
      const fetchImpl = mkFetch({ 'https://a.com': { HEAD: 200 }, 'https://b.com': { HEAD: 301 } });
      const r = await checkUrlLiveness(['https://a.com', 'https://b.com'], { fetchImpl });
      expect(r.broken).toEqual([]);
      expect(r.warned).toEqual([]);
    });

    it('falls back to GET on 403/405/501 and passes if GET 200', async () => {
      const fetchImpl = mkFetch({ 'https://blocked.com': { HEAD: 403, GET: 200 } });
      const r = await checkUrlLiveness(['https://blocked.com'], { fetchImpl });
      expect(r.broken).toEqual([]);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it('flags 4xx (other than 403/405/501) as broken', async () => {
      const fetchImpl = mkFetch({ 'https://gone.com': { HEAD: 404 } });
      const r = await checkUrlLiveness(['https://gone.com'], { fetchImpl });
      expect(r.broken).toHaveLength(1);
      expect(r.broken[0]).toMatchObject({ url: 'https://gone.com', status: 404 });
    });

    it('flags 5xx as broken', async () => {
      const fetchImpl = mkFetch({ 'https://err.com': { HEAD: 500 } });
      const r = await checkUrlLiveness(['https://err.com'], { fetchImpl });
      expect(r.broken).toHaveLength(1);
      expect(r.broken[0].status).toBe(500);
    });

    it('flags HEAD-blocking codes as broken if GET also fails', async () => {
      const fetchImpl = mkFetch({ 'https://both.com': { HEAD: 403, GET: 403 } });
      const r = await checkUrlLiveness(['https://both.com'], { fetchImpl });
      expect(r.broken).toHaveLength(1);
      expect(r.broken[0].status).toBe(403);
    });

    it('routes network errors to warned (non-blocking), not broken', async () => {
      const fetchImpl = mkFetch({ 'https://oops.com': { throws: 'ENOTFOUND' } });
      const r = await checkUrlLiveness(['https://oops.com'], { fetchImpl });
      expect(r.broken).toEqual([]);
      expect(r.warned).toHaveLength(1);
      expect(r.warned[0].url).toBe('https://oops.com');
    });

    it('deduplicates repeated urls', async () => {
      const fetchImpl = mkFetch({ 'https://dup.com': { HEAD: 200 } });
      const r = await checkUrlLiveness(['https://dup.com', 'https://dup.com', 'https://dup.com'], { fetchImpl });
      expect(r.broken).toEqual([]);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });
});
