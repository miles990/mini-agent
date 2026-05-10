import { describe, expect, it } from 'vitest';
import { resolveMiddlewareCycleTimeoutMs } from '../src/middleware-cycle-client.js';

describe('middleware cycle client', () => {
  it('defaults Kuro cycle calls to the same bounded timeout as the local Claude path', () => {
    expect(resolveMiddlewareCycleTimeoutMs()).toBe(90_000);
  });

  it('honors explicit per-call timeout overrides', () => {
    expect(resolveMiddlewareCycleTimeoutMs({ timeoutMs: 12_345 })).toBe(12_345);
  });
});
