import { describe, it, expect } from 'vitest';
import { sanitizeUnpairedSurrogates } from '../src/sanitize.js';

describe('sanitizeUnpairedSurrogates', () => {
  it('passes through ASCII unchanged', () => {
    expect(sanitizeUnpairedSurrogates('hello world')).toBe('hello world');
  });

  it('passes through valid emoji (paired surrogates)', () => {
    const emoji = '😀'; // U+1F600 = D83D DE00 surrogate pair
    expect(sanitizeUnpairedSurrogates(emoji)).toBe(emoji);
  });

  it('passes through CJK BMP characters', () => {
    expect(sanitizeUnpairedSurrogates('中文')).toBe('中文');
  });

  it('replaces lone high surrogate with U+FFFD', () => {
    const lone = '\uD83D';
    expect(sanitizeUnpairedSurrogates(lone)).toBe('\uFFFD');
  });

  it('replaces lone low surrogate with U+FFFD', () => {
    const lone = '\uDE00';
    expect(sanitizeUnpairedSurrogates(lone)).toBe('\uFFFD');
  });

  it('replaces high surrogate not followed by low surrogate', () => {
    const broken = 'a\uD83Db'; // high surrogate followed by 'b'
    expect(sanitizeUnpairedSurrogates(broken)).toBe('a\uFFFDb');
  });

  it('replaces low surrogate not preceded by high surrogate', () => {
    const broken = 'a\uDE00b';
    expect(sanitizeUnpairedSurrogates(broken)).toBe('a\uFFFDb');
  });

  it('preserves valid pair amid broken context', () => {
    const mixed = '\uD83Dvalid\uD83D\uDE00'; // lone high + 'valid' + valid emoji
    expect(sanitizeUnpairedSurrogates(mixed)).toBe('\uFFFDvalid\uD83D\uDE00');
  });

  it('is idempotent', () => {
    const input = 'foo\uD83Dbar😀';
    const once = sanitizeUnpairedSurrogates(input);
    const twice = sanitizeUnpairedSurrogates(once);
    expect(twice).toBe(once);
  });
});
