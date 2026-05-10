import { describe, it, expect } from 'vitest';
import { parseTags, extractDecisionBlock, shouldSuppressStatusNoiseChat, synthesizeDecisionFromProse } from '../src/dispatcher.js';

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
      ids: undefined,
      type: 'goal',
      status: 'in_progress',
      origin: 'perception',
      priority: 1,
      verify: [
        { name: 'typecheck', status: 'pass', detail: undefined },
        { name: 'test', status: 'unknown', detail: undefined },
      ],
      title: 'Implement queue',
      blockReason: undefined,
    });
    expect(result.cleanContent).toBe('');
  });

  it('parses blocked task queue updates with a block reason', () => {
    const result = parseTags('<kuro:task-queue op="update" id="idx-1" status="blocked" block_reason="waiting for external review">Continue with tests first</kuro:task-queue>');
    expect(result.taskQueueActions[0]).toEqual(expect.objectContaining({
      op: 'update',
      id: 'idx-1',
      status: 'blocked',
      title: 'Continue with tests first',
      blockReason: 'waiting for external review',
    }));
  });

  it('parses <kuro:task-queue> resolve tag with ids', () => {
    const result = parseTags('<kuro:task-queue op="resolve" ids="idx-a, idx-b">done</kuro:task-queue>');
    expect(result.taskQueueActions[0]).toEqual({
      op: 'resolve',
      id: undefined,
      ids: ['idx-a', 'idx-b'],
      type: undefined,
      status: undefined,
      origin: undefined,
      priority: undefined,
      verify: undefined,
      title: 'done',
      blockReason: undefined,
    });
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

  it('does not accept unclosed inner tags as working memory', () => {
    const result = parseTags('<kuro:inner>\n</foreground_reply_mode>\n</parameter>\n</invoke>');
    expect(result.inner).toBeUndefined();
  });
});

describe('shouldSuppressStatusNoiseChat', () => {
  it('suppresses non-actionable mushi status notifications', () => {
    expect(shouldSuppressStatusNoiseChat('[mushi] Kuro status changed: online → unknown')).toBe(true);
    expect(shouldSuppressStatusNoiseChat('(no response — status change notification, nothing to act on)')).toBe(true);
  });

  it('keeps actionable status notifications visible', () => {
    expect(shouldSuppressStatusNoiseChat('Autonomy closure blocked: P0 task failed and needs human action')).toBe(false);
    expect(shouldSuppressStatusNoiseChat('[mushi] Kuro status changed: offline; autonomy closure blocked')).toBe(false);
  });
});

// =============================================================================
// extractDecisionBlock Tests — issue #457 regression coverage
// =============================================================================

describe('extractDecisionBlock — newline boundary (#457)', () => {
  it('does NOT pull falsifier text into chose when chose value is empty', () => {
    const block = [
      '## Decision',
      'serving: condition',
      'chose:   ',
      'falsifier: file_exists:/tmp/x',
      'ttl: 3',
    ].join('\n');
    const result = extractDecisionBlock(block);
    // Before #457 fix, `\s*:\s*(.+)$` allowed \s to swallow the newline,
    // so chose mis-captured "falsifier: file_exists:/tmp/x".
    expect(result).not.toBeNull();
    expect(result!.chose).toBeUndefined();
    expect(result!.falsifier).toBe('file_exists:/tmp/x');
  });

  it('does NOT pull next-line content into serving when serving value is empty', () => {
    const block = [
      '## Decision',
      'serving:',
      'chose: do thing because reason',
      'falsifier: grep:/abs "x" >=1',
      'ttl: 5',
    ].join('\n');
    const result = extractDecisionBlock(block);
    expect(result).not.toBeNull();
    expect(result!.serving).toBeUndefined();
    expect(result!.chose).toBe('do thing because reason');
  });

  it('handles bullet + bold-before-colon prefix and CRLF line endings', () => {
    const block = [
      '## Decision',
      '- **chose**: ship the patch',
      '- **falsifier**: file_exists:/tmp/y',
      '- **ttl**: 3',
    ].join('\r\n');
    const result = extractDecisionBlock(block);
    expect(result).not.toBeNull();
    expect(result!.chose).toBe('ship the patch');
    expect(result!.falsifier).toBe('file_exists:/tmp/y');
    expect(result!.ttl).toBe(3);
  });

  it('returns null when no fields present', () => {
    expect(extractDecisionBlock('## Decision\nrandom prose')).toBeNull();
  });
});

describe('synthesizeDecisionFromProse — newline boundary (#457)', () => {
  it('does NOT consume the falsifier line when chose value is empty', () => {
    const prose =
      'I am working on issue #457. ' .repeat(10) + '\n' +
      'chose:   \nfalsifier: file_exists:/tmp/x\n';
    const result = synthesizeDecisionFromProse(prose);
    // Either returns null (chose < 8 chars) or chose is empty/short — must NOT
    // produce chose === "falsifier: file_exists:/tmp/x" mis-capture.
    if (result) {
      expect(result.chose.startsWith('falsifier:')).toBe(false);
    } else {
      expect(result).toBeNull();
    }
  });
});
