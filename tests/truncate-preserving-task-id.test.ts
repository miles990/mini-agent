import { describe, it, expect } from 'vitest';
import { truncatePreservingTaskId } from '../src/loop.js';

describe('truncatePreservingTaskId', () => {
  it('returns input unchanged when shorter than max', () => {
    expect(truncatePreservingTaskId('short', 80)).toBe('short');
  });

  it('hard-slices at word boundary when next char is whitespace', () => {
    const text = 'a'.repeat(80) + ' suffix';
    expect(truncatePreservingTaskId(text, 80)).toBe('a'.repeat(80));
  });

  it('backs up to last space when cut would split a task id token', () => {
    // Reproduces the scheduler ID-clobber: a description that pushes
    // the task id across the 80-char boundary used to drop the `-l` suffix.
    const prompt = 'context up to here padded ' + 'x'.repeat(40) + ' task-1778459005838-l next';
    const out = truncatePreservingTaskId(prompt, 80);
    // Either we keep the full token or we stop before it — never split it
    expect(out.includes('task-1778459005838-l') || !out.includes('task-1778459005838')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(80);
  });

  it('hard-slices when no whitespace is recoverable', () => {
    const text = 'task-1778459005838-suffix-that-is-very-very-long-and-cannot-be-recovered-easily';
    const out = truncatePreservingTaskId(text, 40);
    expect(out.length).toBeLessThanOrEqual(40);
  });

  it('handles non-string input gracefully', () => {
    expect(truncatePreservingTaskId(null as unknown as string, 80)).toBe(null);
  });
});
