import { describe, it, expect } from 'vitest';
import { Semaphore, parseTags } from '../src/dispatcher.js';

// =============================================================================
// Semaphore Tests
// =============================================================================

describe('Semaphore', () => {
  it('allows up to max concurrent acquisitions', async () => {
    const sem = new Semaphore(3);

    await sem.acquire();
    await sem.acquire();
    await sem.acquire();

    const stats = sem.stats();
    expect(stats.active).toBe(3);
    expect(stats.waiting).toBe(0);
    expect(stats.max).toBe(3);
  });

  it('queues when full', async () => {
    const sem = new Semaphore(2);

    await sem.acquire();
    await sem.acquire();

    // Third acquire should wait
    let resolved = false;
    const pending = sem.acquire().then(() => { resolved = true; });

    // Give it a tick
    await new Promise(r => setTimeout(r, 10));
    expect(resolved).toBe(false);
    expect(sem.stats().waiting).toBe(1);

    // Release one — the waiter should be resolved
    sem.release();
    await pending;
    expect(resolved).toBe(true);
    expect(sem.stats().active).toBe(2);
    expect(sem.stats().waiting).toBe(0);
  });

  it('releases waiters in FIFO order', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    const order: number[] = [];

    const p1 = sem.acquire().then(() => { order.push(1); });
    const p2 = sem.acquire().then(() => { order.push(2); });

    expect(sem.stats().waiting).toBe(2);

    // Release twice
    sem.release();
    await p1;
    sem.release();
    await p2;

    expect(order).toEqual([1, 2]);
  });

  it('reports correct stats', () => {
    const sem = new Semaphore(5);
    expect(sem.stats()).toEqual({ active: 0, waiting: 0, max: 5 });
  });
});

// =============================================================================
// parseTags Tests
// =============================================================================

describe('parseTags', () => {
  it('parses <kuro:remember> tag', () => {
    const result = parseTags('Sure! <kuro:remember>User prefers TypeScript</kuro:remember> I noted that.');
    expect(result.remembers[0]).toEqual({ content: 'User prefers TypeScript', topic: undefined, ref: undefined });
    expect(result.cleanContent).toBe('Sure!  I noted that.');
  });

  it('parses <kuro:remember topic="..."> tag', () => {
    const result = parseTags('<kuro:remember topic="gen-art">Domain warp creates organic textures</kuro:remember>');
    expect(result.remembers[0]).toEqual({ content: 'Domain warp creates organic textures', topic: 'gen-art', ref: undefined });
    expect(result.cleanContent).toBe('');
  });

  it('parses <kuro:task> with schedule', () => {
    const result = parseTags('<kuro:task schedule="every 5 minutes">Write a haiku</kuro:task>');
    expect(result.tasks[0]).toEqual({ content: 'Write a haiku', schedule: 'every 5 minutes' });
    expect(result.cleanContent).toBe('');
  });

  it('parses <kuro:task> without schedule', () => {
    const result = parseTags('<kuro:task>Do something</kuro:task>');
    expect(result.tasks[0]).toEqual({ content: 'Do something', schedule: undefined });
  });

  it('parses <kuro:chat> tags', () => {
    const result = parseTags('Text <kuro:chat>Hello Alex</kuro:chat> more <kuro:chat>Another chat</kuro:chat>');
    expect(result.chats).toEqual([{ text: 'Hello Alex', reply: false }, { text: 'Another chat', reply: false }]);
    expect(result.cleanContent).toBe('Text  more');
  });

  it('parses <kuro:show> tags', () => {
    const result = parseTags('<kuro:show url="http://localhost:3000">Check this</kuro:show>');
    expect(result.shows).toEqual([{ url: 'http://localhost:3000', desc: 'Check this' }]);
    expect(result.cleanContent).toBe('');
  });

  it('parses <kuro:show> without url', () => {
    const result = parseTags('<kuro:show>Something to see</kuro:show>');
    expect(result.shows).toEqual([{ url: '', desc: 'Something to see' }]);
  });

  it('parses <kuro:summary> tags', () => {
    const result = parseTags('<kuro:summary>Work done today</kuro:summary>');
    expect(result.summaries).toEqual(['Work done today']);
    expect(result.cleanContent).toBe('');
  });

  it('returns cleanContent with all tags removed', () => {
    const response = '<kuro:remember>Fact</kuro:remember> Hello! <kuro:task>Todo</kuro:task> <kuro:chat>Hi</kuro:chat> <kuro:show url="x">y</kuro:show> <kuro:summary>s</kuro:summary> End.';
    const result = parseTags(response);
    expect(result.cleanContent).toBe('Hello!     End.');
    expect(result.remembers[0]).toEqual({ content: 'Fact', topic: undefined, ref: undefined });
    expect(result.tasks[0]).toEqual({ content: 'Todo', schedule: undefined });
    expect(result.chats).toEqual([{ text: 'Hi', reply: false }]);
    expect(result.shows).toEqual([{ url: 'x', desc: 'y' }]);
    expect(result.summaries).toEqual(['s']);
  });

  it('handles response with no tags', () => {
    const result = parseTags('Just a normal response.');
    expect(result.remembers).toEqual([]);
    expect(result.tasks).toEqual([]);
    expect(result.chats).toEqual([]);
    expect(result.shows).toEqual([]);
    expect(result.summaries).toEqual([]);
    expect(result.cleanContent).toBe('Just a normal response.');
  });

  it('handles multiline tag content', () => {
    const result = parseTags('<kuro:remember>\nLine 1\nLine 2\n</kuro:remember>');
    expect(result.remembers[0]).toEqual({ content: 'Line 1\nLine 2', topic: undefined, ref: undefined });
  });

  it('does not parse tag names mentioned as content', () => {
    const result = parseTags('<kuro:chat>@claude-code I use <kuro:action> for decisions</kuro:chat>\n<kuro:action>## Decision\nreplied</kuro:action>');
    expect(result.chats).toEqual([{ text: '@claude-code I use <kuro:action> for decisions', reply: false }]);
  });
});
