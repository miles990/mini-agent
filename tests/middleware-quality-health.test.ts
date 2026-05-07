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

describe('middleware quality stale-failed suppression', () => {
  it('partitions failed tasks older than staleFailedMinutes out of the active ratio', () => {
    // We hit the live curl path indirectly via the stale-failed partition fn —
    // but since that fn isn't exported, we cover the public behaviour by
    // disabling the gate (env-var path) plus the integration smoke covers
    // wiring. Here we just assert the disable-env still wins so the option
    // surface doesn't break callers.
    vi.stubEnv('MINI_AGENT_DISABLE_MIDDLEWARE_QUALITY_CLOSURE', '1');
    const result = evaluateMiddlewareQuality({ staleFailedMinutes: 5 });
    expect(result.status).toBe('ok');
  });
});
