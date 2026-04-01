import { describe, it, expect } from 'vitest';
import { expandQuery } from '../src/search.js';

describe('expandQuery — bilingual synonym expansion', () => {
  it('expands Chinese to English', () => {
    const result = expandQuery('部署');
    expect(result).toContain('deploy');
    expect(result).toContain('部署');
  });

  it('expands English to Chinese', () => {
    const result = expandQuery('deploy');
    expect(result).toContain('部署');
    expect(result).toContain('release');
  });

  it('preserves original terms', () => {
    const result = expandQuery('custom unique term');
    expect(result).toContain('custom');
    expect(result).toContain('unique');
    expect(result).toContain('term');
  });

  it('handles mixed language queries', () => {
    const result = expandQuery('deploy 測試');
    expect(result).toContain('部署');
    expect(result).toContain('test');
    expect(result).toContain('testing');
  });

  it('caps expansion to 30 terms', () => {
    const longQuery = 'deploy fail memory search learn task test fix performance config';
    const result = expandQuery(longQuery);
    expect(result.length).toBeLessThanOrEqual(30);
  });

  it('filters out single-character terms', () => {
    const result = expandQuery('a b deploy');
    // 'a' and 'b' should be filtered (< 2 chars)
    expect(result).not.toContain('a');
    expect(result).not.toContain('b');
    expect(result).toContain('deploy');
  });

  it('is case-insensitive', () => {
    const result = expandQuery('Deploy');
    expect(result).toContain('部署');
  });
});
