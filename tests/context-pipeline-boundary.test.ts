import { describe, it, expect } from 'vitest';
import { truncateAtSectionBoundary } from '../src/context-pipeline.js';

describe('truncateAtSectionBoundary', () => {
  it('returns input unchanged when within budget', () => {
    const text = '<a>hello</a>';
    expect(truncateAtSectionBoundary(text, 100)).toBe(text);
  });

  it('never cuts inside a closing tag', () => {
    // Length 40, budget 38 — naive slice(0,38) would cut the last </memory> mid-tag
    const text = '<soul>id</soul>\n<memory>data</memory>XX';
    const out = truncateAtSectionBoundary(text, 38);
    // Must end at a </tag> boundary, not mid-tag
    expect(out.endsWith('>')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(38);
    // Specifically, must NOT leave a dangling partial close tag
    expect(out).not.toMatch(/<\/\w+$/);
  });

  it('reproduces the garbage-output scenario and fixes it', () => {
    // Simulate the 2026-04-17 foreground incident:
    // context ends with </chat-room-recent></memory>, budget cuts 40 chars short,
    // raw slice would strip the </memory> close tag and Claude fills it in.
    const context = '<memory>\n<chat-room-recent>[alex] test</chat-room-recent>\n</memory>\n[... tail padding ...]';
    const budget = context.length - 10;
    const out = truncateAtSectionBoundary(context, budget);
    // The result must end at a structural boundary — every opened tag has a matching close
    const opens = [...out.matchAll(/<(\w[\w-]*)>/g)].map(m => m[1]);
    const closes = [...out.matchAll(/<\/(\w[\w-]*)>/g)].map(m => m[1]);
    expect(opens.sort()).toEqual(closes.sort());
  });

  it('gracefully handles text with no XML', () => {
    const text = 'a'.repeat(200);
    const out = truncateAtSectionBoundary(text, 50);
    expect(out.length).toBe(50);
  });

  it('accepts oversize first section (caller bears the risk)', () => {
    // If the very first section is larger than budget, there is no safe cut —
    // function returns a raw slice as last resort. Caller should raise budget.
    const text = '<huge>' + 'x'.repeat(1000) + '</huge>';
    const out = truncateAtSectionBoundary(text, 100);
    expect(out.length).toBe(100);
  });
});
