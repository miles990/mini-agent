/**
 * Middleware Events Client (T14) — SSE subscription for critical middleware events.
 *
 * Per brain-only-kuro-v2 proposal §7 Phase D T14. Subscribes to middleware
 * /events stream filtered by severity (default: critical,anomaly),
 * emits trigger:alert on eventBus with source="middleware" when severe events arrive.
 *
 * Design principles:
 *   - OFF by default — opt-in via startMiddlewareEventSubscription()
 *   - Exponential backoff reconnect (1s → 2s → 4s → 8s → 16s → cap 60s)
 *   - Routes through existing trigger:alert event (with source="middleware")
 *     instead of adding new EventName (keeps event-bus.ts API stable)
 *   - Only critical & anomaly severities → trigger:alert (routine/info not forwarded)
 *   - AbortController for clean shutdown
 *   - Native fetch SSE parsing (no eventsource polyfill)
 */

import { eventBus } from './event-bus.js';
import { slog } from './utils.js';

export interface SubscriptionOptions {
  /** Comma-separated severity list. Default: "critical,anomaly" */
  severity?: string;
  /** Middleware base URL. Default: MIDDLEWARE_URL env or http://localhost:3200 */
  baseUrl?: string;
  /** Maximum reconnect backoff in ms. Default 60_000. */
  maxBackoffMs?: number;
  /** API key for authorization. Default: env MIDDLEWARE_API_KEY */
  apiKey?: string;
  /** Stop after N reconnect attempts (0 = infinite). Default 0. */
  maxAttempts?: number;
}

export interface SubscriptionHandle {
  /** Stops the subscription — no more reconnects. */
  stop: () => void;
  /** Current connection state (for observability). */
  getState: () => {
    connected: boolean;
    attempts: number;
    lastEventAt: number | null;
    lastError: string | null;
  };
}

interface ParsedSseEvent {
  event?: string;
  data?: string;
}

/**
 * Minimal SSE parser for `text/event-stream`.
 * Yields complete events (lines separated by blank line).
 */
async function* parseSseStream(stream: ReadableStream<Uint8Array>): AsyncIterable<ParsedSseEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      // Events are separated by blank lines (\n\n)
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const ev: ParsedSseEvent = {};
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) ev.event = line.slice(6).trim();
          else if (line.startsWith('data:')) ev.data = (ev.data ?? '') + line.slice(5).trim();
        }
        if (ev.event || ev.data) yield ev;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function startMiddlewareEventSubscription(opts?: SubscriptionOptions): SubscriptionHandle {
  const baseUrl = opts?.baseUrl ?? process.env.MIDDLEWARE_URL ?? 'http://localhost:3200';
  const severity = opts?.severity ?? 'critical,anomaly';
  const maxBackoffMs = opts?.maxBackoffMs ?? 60_000;
  const apiKey = opts?.apiKey ?? process.env.MIDDLEWARE_API_KEY;
  const maxAttempts = opts?.maxAttempts ?? 0;

  const state = {
    connected: false,
    attempts: 0,
    lastEventAt: null as number | null,
    lastError: null as string | null,
  };

  let abortController: AbortController | null = null;
  let stopped = false;
  let reconnectTimer: NodeJS.Timeout | null = null;

  const stop = () => {
    stopped = true;
    if (abortController) { try { abortController.abort(); } catch { /* noop */ } }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    state.connected = false;
  };

  const computeBackoff = (attempt: number) => {
    const base = Math.min(1000 * Math.pow(2, Math.min(attempt, 6)), maxBackoffMs);
    // Jitter ±20% to avoid thundering herd
    const jitter = base * 0.2 * (Math.random() - 0.5);
    return Math.round(base + jitter);
  };

  const connect = async (): Promise<void> => {
    if (stopped) return;
    state.attempts++;
    if (maxAttempts > 0 && state.attempts > maxAttempts) {
      slog('MW-EVENTS', `max attempts (${maxAttempts}) reached — stopping`);
      stop();
      return;
    }

    abortController = new AbortController();
    const url = `${baseUrl}/events?severity=${encodeURIComponent(severity)}`;
    const headers: Record<string, string> = { 'Accept': 'text/event-stream' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers,
        signal: abortController.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      if (!res.body) {
        throw new Error('no response body');
      }

      state.connected = true;
      state.attempts = 0; // Reset on successful connect
      state.lastError = null;
      slog('MW-EVENTS', `subscribed ${url}`);

      for await (const sseEvent of parseSseStream(res.body)) {
        if (stopped) break;
        state.lastEventAt = Date.now();

        // Skip pings
        if (sseEvent.event === 'ping') continue;

        // Parse data payload
        let payload: Record<string, unknown> = {};
        if (sseEvent.data) {
          try { payload = JSON.parse(sseEvent.data); } catch { /* keep as raw string */ }
        }
        const sev = typeof payload.severity === 'string' ? payload.severity : 'unknown';

        // Forward to event bus as trigger:alert with source="middleware"
        eventBus.emit('trigger:alert', {
          type: 'trigger:alert',
          timestamp: new Date(),
          priority: sev === 'critical' ? 'P1' : 'P2',
          source: 'middleware',
          data: {
            event_type: sseEvent.event ?? 'unknown',
            severity: sev,
            ...payload,
          },
        });

        slog('MW-EVENTS', `alert ${sseEvent.event ?? 'event'} severity=${sev}`);
      }

      // Stream ended cleanly — reconnect if not stopped
      state.connected = false;
      if (!stopped) scheduleReconnect();
    } catch (err) {
      state.connected = false;
      const msg = err instanceof Error ? err.message : String(err);
      state.lastError = msg;
      // Ignore abort errors (intentional stop)
      if (!stopped) {
        slog('MW-EVENTS', `connection error: ${msg.slice(0, 100)} — reconnecting`);
        scheduleReconnect();
      }
    }
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    const delay = computeBackoff(state.attempts);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect().catch(() => { /* swallowed; scheduleReconnect handled */ });
    }, delay);
  };

  // Initial connect (fire and forget)
  connect().catch(() => { /* handled by scheduleReconnect */ });

  return {
    stop,
    getState: () => ({ ...state }),
  };
}
