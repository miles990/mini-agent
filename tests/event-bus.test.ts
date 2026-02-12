import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentEventBus, debounce, throttle, distinctUntilChanged } from '../src/event-bus.js';
import type { AgentEvent } from '../src/event-bus.js';

describe('AgentEventBus', () => {
  let bus: AgentEventBus;

  beforeEach(() => {
    bus = new AgentEventBus();
  });

  afterEach(() => {
    bus.removeAllListeners();
  });

  it('emit + on basic flow', () => {
    const events: AgentEvent[] = [];
    bus.on('trigger:workspace', (e) => events.push(e));

    bus.emit('trigger:workspace', { files: 3 });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('trigger:workspace');
    expect(events[0].data).toEqual({ files: 3 });
    expect(events[0].timestamp).toBeInstanceOf(Date);
  });

  it('wildcard pattern receives all events of same prefix', () => {
    const events: AgentEvent[] = [];
    bus.on('trigger:*', (e) => events.push(e));

    bus.emit('trigger:workspace');
    bus.emit('trigger:telegram');
    bus.emit('trigger:cron');
    bus.emit('action:loop'); // different prefix — should not match

    expect(events).toHaveLength(3);
    expect(events.map((e) => e.type)).toEqual([
      'trigger:workspace',
      'trigger:telegram',
      'trigger:cron',
    ]);
  });

  it('specific + wildcard both fire', () => {
    const specific: AgentEvent[] = [];
    const wildcard: AgentEvent[] = [];
    bus.on('action:loop', (e) => specific.push(e));
    bus.on('action:*', (e) => wildcard.push(e));

    bus.emit('action:loop', { cycle: 1 });

    expect(specific).toHaveLength(1);
    expect(wildcard).toHaveLength(1);
  });

  it('off removes handler', () => {
    const events: AgentEvent[] = [];
    const handler = (e: AgentEvent) => events.push(e);

    bus.on('log:info', handler);
    bus.emit('log:info');
    expect(events).toHaveLength(1);

    bus.off('log:info', handler);
    bus.emit('log:info');
    expect(events).toHaveLength(1); // no new event
  });

  it('once fires only once', () => {
    const events: AgentEvent[] = [];
    bus.once('notification:signal', (e) => events.push(e));

    bus.emit('notification:signal');
    bus.emit('notification:signal');

    expect(events).toHaveLength(1);
  });

  it('emit with no data defaults to empty object', () => {
    const events: AgentEvent[] = [];
    bus.on('log:error', (e) => events.push(e));

    bus.emit('log:error');

    expect(events[0].data).toEqual({});
  });
});

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('delays execution', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('resets timer on repeated calls', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    vi.advanceTimersByTime(50);
    debounced(); // reset
    vi.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledOnce();
  });

  it('cancel prevents execution', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    debounced.cancel();
    vi.advanceTimersByTime(200);

    expect(fn).not.toHaveBeenCalled();
  });

  it('passes arguments to original function', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('a', 'b');
    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledWith('a', 'b');
  });
});

describe('throttle', () => {
  it('executes immediately on first call', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled();
    expect(fn).toHaveBeenCalledOnce();
  });

  it('blocks calls within interval', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);

    throttled();
    expect(fn).toHaveBeenCalledOnce();

    vi.spyOn(Date, 'now').mockReturnValue(now + 50);
    throttled();
    expect(fn).toHaveBeenCalledOnce(); // still 1

    vi.spyOn(Date, 'now').mockReturnValue(now + 100);
    throttled();
    expect(fn).toHaveBeenCalledTimes(2);

    vi.restoreAllMocks();
  });

  it('passes arguments to original function', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('x', 42);
    expect(fn).toHaveBeenCalledWith('x', 42);
  });
});

describe('distinctUntilChanged', () => {
  it('returns true on first call', () => {
    const isChanged = distinctUntilChanged((s: string) => s);
    expect(isChanged('hello')).toBe(true);
  });

  it('returns false for same hash', () => {
    const isChanged = distinctUntilChanged((s: string) => s);
    isChanged('hello');
    expect(isChanged('hello')).toBe(false);
  });

  it('returns true when hash changes', () => {
    const isChanged = distinctUntilChanged((s: string) => s);
    isChanged('hello');
    expect(isChanged('world')).toBe(true);
  });

  it('works with custom hash function', () => {
    const isChanged = distinctUntilChanged((n: number) => String(n % 2));
    expect(isChanged(1)).toBe(true);  // hash "1"
    expect(isChanged(3)).toBe(false); // hash "1" — same
    expect(isChanged(4)).toBe(true);  // hash "0" — changed
    expect(isChanged(6)).toBe(false); // hash "0" — same
  });
});
