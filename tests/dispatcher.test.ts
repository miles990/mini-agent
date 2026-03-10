import { describe, it, expect } from 'vitest';
import { parseTags } from '../src/dispatcher.js';

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

  it('parses <kuro:task-queue> create tag', () => {
    const result = parseTags('<kuro:task-queue op="create" type="goal" status="in_progress" origin="perception" priority="1" verify="typecheck:pass,test:unknown">Implement queue</kuro:task-queue>');
    expect(result.taskQueueActions[0]).toEqual({
      op: 'create',
      id: undefined,
      type: 'goal',
      status: 'in_progress',
      origin: 'perception',
      priority: 1,
      verify: [
        { name: 'typecheck', status: 'pass', detail: undefined },
        { name: 'test', status: 'unknown', detail: undefined },
      ],
      title: 'Implement queue',
    });
    expect(result.cleanContent).toBe('');
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
    expect(result.taskQueueActions).toEqual([]);
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

  it('preserves inline code in chat text', () => {
    const result = parseTags('<kuro:chat>Use `<kuro:schedule next="now">` for continuation</kuro:chat>');
    expect(result.chats[0].text).toContain('`<kuro:schedule next="now">`');
  });

  it('preserves inline code in inner text', () => {
    const result = parseTags('<kuro:inner>Tracking: `<kuro:schedule>` usage</kuro:inner>');
    expect(result.inner).toContain('`<kuro:schedule>`');
  });
});
