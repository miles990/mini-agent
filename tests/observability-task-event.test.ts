import { describe, expect, it } from 'vitest';
import { taskEventContent } from '../src/observability.js';

describe('observability task event content', () => {
  it('uses content when present', () => {
    expect(taskEventContent({ content: 'write regression test' })).toBe('write regression test');
  });

  it('formats structured task lifecycle events without content', () => {
    expect(taskEventContent({
      event: 'autonomy-closure-repair-queued',
      taskId: 'idx-123',
    })).toBe('autonomy-closure-repair-queued:idx-123');
  });

  it('falls back to entry summary or a safe placeholder', () => {
    expect(taskEventContent({ entry: { summary: 'queued from memory index' } })).toBe('queued from memory index');
    expect(taskEventContent({})).toBe('task event');
  });
});
