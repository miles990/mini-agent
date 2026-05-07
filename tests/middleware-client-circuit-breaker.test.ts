import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMiddlewareClient,
  getMiddlewareCircuitState,
  MiddlewareCircuitOpenError,
  MiddlewareOfflineError,
  resetMiddlewareCircuitBreaker,
  type Transport,
} from '../src/middleware-client.js';

function offlineTransport(baseUrl: string): Transport {
  return {
    request: vi.fn(async () => {
      throw new MiddlewareOfflineError(baseUrl);
    }),
  };
}

describe('middleware client circuit breaker', () => {
  const baseUrl = 'http://middleware.test';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-07T00:00:00.000Z'));
    resetMiddlewareCircuitBreaker();
  });

  afterEach(() => {
    resetMiddlewareCircuitBreaker();
    vi.useRealTimers();
  });

  it('opens after repeated offline dispatch failures and fails fast during backoff', async () => {
    const transport = offlineTransport(baseUrl);
    const client = createMiddlewareClient({
      baseUrl,
      transport,
      circuitBreaker: {
        failureThreshold: 3,
        initialBackoffMs: 1000,
        maxBackoffMs: 8000,
      },
    });

    await expect(client.dispatch({ worker: 'coder', task: 'one' })).rejects.toBeInstanceOf(MiddlewareOfflineError);
    await expect(client.dispatch({ worker: 'coder', task: 'two' })).rejects.toBeInstanceOf(MiddlewareOfflineError);
    await expect(client.dispatch({ worker: 'coder', task: 'three' })).rejects.toBeInstanceOf(MiddlewareOfflineError);

    expect(getMiddlewareCircuitState(baseUrl)).toEqual(expect.objectContaining({
      state: 'open',
      failureCount: 3,
      openedUntil: '2026-05-07T00:00:01.000Z',
    }));

    await expect(client.dispatch({ worker: 'coder', task: 'blocked' })).rejects.toBeInstanceOf(MiddlewareCircuitOpenError);
    expect(transport.request).toHaveBeenCalledTimes(3);

    vi.advanceTimersByTime(1000);
    await expect(client.dispatch({ worker: 'coder', task: 'probe after backoff' })).rejects.toBeInstanceOf(MiddlewareOfflineError);

    expect(getMiddlewareCircuitState(baseUrl)).toEqual(expect.objectContaining({
      state: 'open',
      failureCount: 4,
      openedUntil: '2026-05-07T00:00:03.000Z',
    }));
    expect(transport.request).toHaveBeenCalledTimes(4);
  });

  it('allows health probes while open and resets the circuit on healthy middleware', async () => {
    const transport: Transport = {
      request: vi.fn(async (_method, path) => {
        if (path === '/health') {
          return {
            status: 'ok',
            service: 'agent-middleware',
            workers: ['coder'],
            tasks: 0,
          };
        }
        throw new MiddlewareOfflineError(baseUrl);
      }),
    };
    const client = createMiddlewareClient({
      baseUrl,
      transport,
      circuitBreaker: {
        failureThreshold: 1,
        initialBackoffMs: 60_000,
        maxBackoffMs: 60_000,
      },
    });

    await expect(client.dispatch({ worker: 'coder', task: 'open circuit' })).rejects.toBeInstanceOf(MiddlewareOfflineError);
    expect(getMiddlewareCircuitState(baseUrl).state).toBe('open');

    await expect(client.health()).resolves.toEqual(expect.objectContaining({ status: 'ok' }));
    expect(getMiddlewareCircuitState(baseUrl)).toEqual(expect.objectContaining({
      state: 'closed',
      failureCount: 0,
    }));

    await expect(client.dispatch({ worker: 'coder', task: 'allowed after health reset' })).rejects.toBeInstanceOf(MiddlewareOfflineError);
    expect(transport.request).toHaveBeenCalledTimes(3);
  });

  it('does not gate status polling or commitment reads', async () => {
    const transport = offlineTransport(baseUrl);
    const client = createMiddlewareClient({
      baseUrl,
      transport,
      circuitBreaker: {
        failureThreshold: 1,
        initialBackoffMs: 60_000,
        maxBackoffMs: 60_000,
      },
    });

    await expect(client.dispatch({ worker: 'coder', task: 'open circuit' })).rejects.toBeInstanceOf(MiddlewareOfflineError);
    await expect(client.status('mw-1')).rejects.toBeInstanceOf(MiddlewareOfflineError);
    await expect(client.listCommitments({ status: 'active' })).rejects.toBeInstanceOf(MiddlewareOfflineError);

    expect(transport.request).toHaveBeenCalledTimes(3);
  });
});
