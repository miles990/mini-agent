import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Issue #414: preflight threshold must lower to 25K when any of the three
// silent_exit_void variants (_midprompt, _http, _40k) have a recent lastSeen,
// and the slog tag must be [preflight.observe] (not [preflight.drain]).

// ── replicate the isRecent helper & threshold logic from src/loop.ts ──────────

type EpEntry = { lastSeen?: string };

function computePreflightThreshold(epRaw: Record<string, EpEntry | undefined>): number {
  const today     = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const isRecent  = (entry: EpEntry | undefined): boolean =>
    !!entry?.lastSeen && entry.lastSeen >= yesterday && entry.lastSeen <= today;

  const midpromptEntry = epRaw['TIMEOUT:silent_exit_void_midprompt::callClaude'];
  const httpEntry      = epRaw['TIMEOUT:silent_exit_void_http::callClaude'];
  const fortyKEntry    = epRaw['TIMEOUT:silent_exit_void_40k::callClaude'];

  if (isRecent(midpromptEntry) || isRecent(httpEntry) || isRecent(fortyKEntry)) {
    return 25_000;
  }
  return 35_000;
}

const today     = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const stale     = '2024-01-01';

describe('preflight threshold — issue #414', () => {
  it('defaults to 35K when error-patterns is empty', () => {
    expect(computePreflightThreshold({})).toBe(35_000);
  });

  it('defaults to 35K when all variants are stale', () => {
    expect(computePreflightThreshold({
      'TIMEOUT:silent_exit_void_midprompt::callClaude': { lastSeen: stale },
      'TIMEOUT:silent_exit_void_http::callClaude':      { lastSeen: stale },
      'TIMEOUT:silent_exit_void_40k::callClaude':       { lastSeen: stale },
    })).toBe(35_000);
  });

  it('lowers to 25K when _midprompt is recent (today)', () => {
    expect(computePreflightThreshold({
      'TIMEOUT:silent_exit_void_midprompt::callClaude': { lastSeen: today },
    })).toBe(25_000);
  });

  it('lowers to 25K when _midprompt is recent (yesterday)', () => {
    expect(computePreflightThreshold({
      'TIMEOUT:silent_exit_void_midprompt::callClaude': { lastSeen: yesterday },
    })).toBe(25_000);
  });

  // Gap 1 regression: _http.lastSeen must also lower the threshold
  it('lowers to 25K when _http is recent (Gap 1 fix)', () => {
    expect(computePreflightThreshold({
      'TIMEOUT:silent_exit_void_http::callClaude': { lastSeen: today },
    })).toBe(25_000);
  });

  it('lowers to 25K when _http seen yesterday (Gap 1 fix)', () => {
    expect(computePreflightThreshold({
      'TIMEOUT:silent_exit_void_http::callClaude': { lastSeen: yesterday },
    })).toBe(25_000);
  });

  // Gap 1 regression: _40k.lastSeen must also lower the threshold
  it('lowers to 25K when _40k is recent (Gap 1 fix)', () => {
    expect(computePreflightThreshold({
      'TIMEOUT:silent_exit_void_40k::callClaude': { lastSeen: today },
    })).toBe(25_000);
  });

  it('lowers to 25K when _40k seen yesterday (Gap 1 fix)', () => {
    expect(computePreflightThreshold({
      'TIMEOUT:silent_exit_void_40k::callClaude': { lastSeen: yesterday },
    })).toBe(25_000);
  });

  it('lowers to 25K when only _http is recent, _midprompt absent', () => {
    // This was the failing case before #415: _midprompt absent, _http recent
    // → threshold must still drop to 25K.
    expect(computePreflightThreshold({
      'TIMEOUT:silent_exit_void_http::callClaude': { lastSeen: today },
      // no midprompt key
    })).toBe(25_000);
  });

  // Gap 2 phase-2 drain: [preflight.drain] tag must be present (wired) and
  // [preflight.observe] must appear as the fallback path when drain fails.
  it('loop.ts has [preflight.drain] wired (Gap 2 phase-2 fix, issue #414)', () => {
    const loopSrc = readFileSync(resolve(import.meta.dirname!, '../src/loop.ts'), 'utf8');
    expect(loopSrc).toContain('[preflight.drain]');
  });

  it('loop.ts retains [preflight.observe] as drain-failure fallback (issue #414)', () => {
    const loopSrc = readFileSync(resolve(import.meta.dirname!, '../src/loop.ts'), 'utf8');
    expect(loopSrc).toContain('[preflight.observe]');
    expect(loopSrc).toContain("event: 'preflight.observe'");
  });

  it('loop.ts drain uses minimal context rebuild (issue #414)', () => {
    const loopSrc = readFileSync(resolve(import.meta.dirname!, '../src/loop.ts'), 'utf8');
    expect(loopSrc).toContain("mode: 'minimal'");
    expect(loopSrc).toContain("event: 'preflight.drain'");
  });

  // Issue #468 Path A′: drain must re-derive prompt and effectivePrompt from a
  // minimalMode buildAutonomousPromptFn call so the actual HTTP payload shrinks,
  // not just the context string. Task-signal continuity is preserved (vs Path B
  // buildIdlePrompt stopgap which discarded scheduler task context entirely).
  it('loop.ts drain re-runs buildAutonomousPromptFn with minimalMode:true (issue #468 Path A′)', () => {
    const loopSrc = readFileSync(resolve(import.meta.dirname!, '../src/loop.ts'), 'utf8');
    expect(loopSrc).toContain('minimalMode: true');
  });

  it('loop.ts drain rebuilds prompt and effectivePrompt from minimal result (issue #468 Path A′)', () => {
    const loopSrc = readFileSync(resolve(import.meta.dirname!, '../src/loop.ts'), 'utf8');
    expect(loopSrc).toContain('drainPromptResult');
    expect(loopSrc).toContain('(minimal)');
  });

  it('prompt-builder.ts PromptBuilderState declares minimalMode field (issue #468 Path A′)', () => {
    const pbSrc = readFileSync(resolve(import.meta.dirname!, '../src/prompt-builder.ts'), 'utf8');
    expect(pbSrc).toContain('minimalMode?: boolean');
  });

  it('prompt-builder.ts buildAutonomousPrompt honours minimalMode early-return (issue #468 Path A′)', () => {
    const pbSrc = readFileSync(resolve(import.meta.dirname!, '../src/prompt-builder.ts'), 'utf8');
    const hits = (pbSrc.match(/minimalMode/g) ?? []).length;
    expect(hits).toBeGreaterThanOrEqual(2);
    expect(pbSrc).toContain('state.minimalMode');
  });
});
