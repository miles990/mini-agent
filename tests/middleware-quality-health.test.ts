import { afterEach, describe, expect, it, vi } from 'vitest';
import { evaluateMiddlewareQuality } from '../src/middleware-quality-health.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('middleware quality health', () => {
  it('can be disabled for isolated tests', () => {
    vi.stubEnv('MINI_AGENT_DISABLE_MIDDLEWARE_QUALITY_CLOSURE', '1');

    const result = evaluateMiddlewareQuality();

    expect(result.status).toBe('ok');
    expect(result.summary).toContain('disabled');
  });

  it('warns when middleware is unreachable', () => {
    const result = evaluateMiddlewareQuality({
      baseUrl: 'http://127.0.0.1:9',
      timeoutSeconds: 1,
    });

    expect(result.status).toBe('warn');
    expect(result.summary).toContain('unreachable');
  });
});
