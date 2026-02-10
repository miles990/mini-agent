import { describe, it, expect } from 'vitest';
import { Semaphore, parseTags, triageMessage } from '../src/dispatcher.js';

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
  it('parses [REMEMBER] tag', () => {
    const result = parseTags('Sure! [REMEMBER]User prefers TypeScript[/REMEMBER] I noted that.');
    expect(result.remember).toEqual({ content: 'User prefers TypeScript', topic: undefined });
    expect(result.cleanContent).toBe('Sure!  I noted that.');
  });

  it('parses [REMEMBER #topic] tag', () => {
    const result = parseTags('[REMEMBER #gen-art]Domain warp creates organic textures[/REMEMBER]');
    expect(result.remember).toEqual({ content: 'Domain warp creates organic textures', topic: 'gen-art' });
    expect(result.cleanContent).toBe('');
  });

  it('parses [TASK] with schedule', () => {
    const result = parseTags('[TASK schedule="every 5 minutes"]Write a haiku[/TASK]');
    expect(result.task).toEqual({ content: 'Write a haiku', schedule: 'every 5 minutes' });
    expect(result.cleanContent).toBe('');
  });

  it('parses [TASK] without schedule', () => {
    const result = parseTags('[TASK]Do something[/TASK]');
    expect(result.task).toEqual({ content: 'Do something', schedule: undefined });
  });

  it('parses [CHAT] tags', () => {
    const result = parseTags('Text [CHAT]Hello Alex[/CHAT] more [CHAT]Another chat[/CHAT]');
    expect(result.chats).toEqual(['Hello Alex', 'Another chat']);
    expect(result.cleanContent).toBe('Text  more');
  });

  it('parses [SHOW] tags', () => {
    const result = parseTags('[SHOW url="http://localhost:3000"]Check this[/SHOW]');
    expect(result.shows).toEqual([{ url: 'http://localhost:3000', desc: 'Check this' }]);
    expect(result.cleanContent).toBe('');
  });

  it('parses [SHOW] without url', () => {
    const result = parseTags('[SHOW]Something to see[/SHOW]');
    expect(result.shows).toEqual([{ url: '', desc: 'Something to see' }]);
  });

  it('parses [SUMMARY] tags', () => {
    const result = parseTags('[SUMMARY]Work done today[/SUMMARY]');
    expect(result.summaries).toEqual(['Work done today']);
    expect(result.cleanContent).toBe('');
  });

  it('returns cleanContent with all tags removed', () => {
    const response = '[REMEMBER]Fact[/REMEMBER] Hello! [TASK]Todo[/TASK] [CHAT]Hi[/CHAT] [SHOW url="x"]y[/SHOW] [SUMMARY]s[/SUMMARY] End.';
    const result = parseTags(response);
    expect(result.cleanContent).toBe('Hello!     End.');
    expect(result.remember).toEqual({ content: 'Fact', topic: undefined });
    expect(result.task).toEqual({ content: 'Todo', schedule: undefined });
    expect(result.chats).toEqual(['Hi']);
    expect(result.shows).toEqual([{ url: 'x', desc: 'y' }]);
    expect(result.summaries).toEqual(['s']);
  });

  it('handles response with no tags', () => {
    const result = parseTags('Just a normal response.');
    expect(result.remember).toBeUndefined();
    expect(result.task).toBeUndefined();
    expect(result.chats).toEqual([]);
    expect(result.shows).toEqual([]);
    expect(result.summaries).toEqual([]);
    expect(result.cleanContent).toBe('Just a normal response.');
  });

  it('handles multiline tag content', () => {
    const result = parseTags('[REMEMBER]\nLine 1\nLine 2\n[/REMEMBER]');
    expect(result.remember).toEqual({ content: 'Line 1\nLine 2', topic: undefined });
  });
});

// =============================================================================
// triageMessage Tests (regex-based, no API calls)
// =============================================================================

describe('triageMessage', () => {
  it('classifies simple greetings as haiku', async () => {
    expect((await triageMessage('hi')).lane).toBe('haiku');
    expect((await triageMessage('Hello!')).lane).toBe('haiku');
    expect((await triageMessage('你好')).lane).toBe('haiku');
    expect((await triageMessage('哈囉')).lane).toBe('haiku');
    expect((await triageMessage('hey there')).lane).toBe('haiku');
  });

  it('classifies simple replies as haiku', async () => {
    expect((await triageMessage('thanks')).lane).toBe('haiku');
    expect((await triageMessage('好的')).lane).toBe('haiku');
    expect((await triageMessage('OK')).lane).toBe('haiku');
    expect((await triageMessage('了解')).lane).toBe('haiku');
  });

  it('classifies time questions as haiku', async () => {
    expect((await triageMessage('幾點了')).lane).toBe('haiku');
    expect((await triageMessage('what time is it')).lane).toBe('haiku');
  });

  it('classifies complex commands as claude', async () => {
    expect((await triageMessage('deploy the latest version')).lane).toBe('claude');
    expect((await triageMessage('部署最新版')).lane).toBe('claude');
    expect((await triageMessage('create a new file')).lane).toBe('claude');
    expect((await triageMessage('fix this bug')).lane).toBe('claude');
    expect((await triageMessage('run the tests')).lane).toBe('claude');
  });

  it('classifies agent tags as complex', async () => {
    expect((await triageMessage('[ACTION]do something[/ACTION]')).lane).toBe('claude');
    expect((await triageMessage('[TASK]check disk[/TASK]')).lane).toBe('claude');
    expect((await triageMessage('[REMEMBER]save this[/REMEMBER]')).lane).toBe('claude');
  });

  it('falls through to claude when no pattern matches (no API key)', async () => {
    // Without ANTHROPIC_API_KEY, unmatched messages default to claude
    const original = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const result = await triageMessage('what is the meaning of life');
      expect(result.lane).toBe('claude');
      expect(result.reason).toBe('no-api-key');
    } finally {
      if (original) process.env.ANTHROPIC_API_KEY = original;
    }
  });
});
