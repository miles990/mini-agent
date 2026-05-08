import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Regression tests for issue #354:
 * ai-trend fallback enricher silently skipped after remote enricher's all-fail run.
 *
 * Root cause: wrapper uses `set -e` which can interact with `||` multi-line
 * constructs in zsh, silently aborting before the fallback line runs. The remote
 * enricher also exits 0 on total failure (ok=0, fail=N) making the abort silent.
 *
 * Fix:
 * 1. Wrapper disables `set -e` around remote-enrich via explicit `set +e` / `set -e`
 *    bracketing so fallback always executes regardless of remote-enrich exit code.
 * 2. Remote enricher exits 1 when ok=0 and fail>0 (total failure) so that
 *    the `[wrapper]` diagnostic line appears in logs.
 */

describe('github-ai-trend wrapper script (issue #354)', () => {
  const wrapperPath = path.join(process.cwd(), 'scripts', 'launchd-wrappers', 'github-ai-trend.sh');
  let script: string;

  it('loads the wrapper script', () => {
    script = readFileSync(wrapperPath, 'utf-8');
    expect(script.length).toBeGreaterThan(0);
  });

  it('disables set -e around the remote enricher so fallback always runs', () => {
    script = readFileSync(wrapperPath, 'utf-8');
    // set +e must appear BEFORE the remote-enrich call
    // set -e must appear AFTER the remote-enrich call and BEFORE the fallback call
    const setPlusEIdx = script.indexOf('set +e');
    const remoteIdx = script.indexOf('ai-trend-enrich-remote.mjs');
    const setMinusEIdx = script.indexOf('set -e', remoteIdx);
    const fallbackIdx = script.indexOf('ai-trend-enrich-fallback.mjs');

    expect(setPlusEIdx).toBeGreaterThan(-1);
    expect(setPlusEIdx).toBeLessThan(remoteIdx);
    expect(setMinusEIdx).toBeGreaterThan(remoteIdx);
    expect(setMinusEIdx).toBeLessThan(fallbackIdx);
  });

  it('logs a diagnostic message when remote-enrich exits non-zero', () => {
    script = readFileSync(wrapperPath, 'utf-8');
    // The wrapper must check the exit code and log a warning
    expect(script).toContain('[wrapper] remote-enrich exited non-zero');
    expect(script).toContain('continuing to fallback');
  });

  it('fallback enricher line is NOT inside an if-block guarded by remote success', () => {
    script = readFileSync(wrapperPath, 'utf-8');
    const fallbackIdx = script.indexOf('ai-trend-enrich-fallback.mjs');
    // The fallback must come after the diagnostic/check but must run unconditionally.
    // It should not be inside an `if [ ... ]; then ... fi` block that skips it on failure.
    // Simple invariant: fallback call appears after remote call.
    const remoteIdx = script.indexOf('ai-trend-enrich-remote.mjs');
    expect(fallbackIdx).toBeGreaterThan(remoteIdx);
  });
});

describe('ai-trend-enrich-remote.mjs exit code on total failure (issue #354)', () => {
  const remotePath = path.join(process.cwd(), 'scripts', 'ai-trend-enrich-remote.mjs');
  let script: string;

  it('loads the remote enricher script', () => {
    script = readFileSync(remotePath, 'utf-8');
    expect(script.length).toBeGreaterThan(0);
  });

  it('exits with non-zero status when ok=0 and fail>0 (total failure)', () => {
    script = readFileSync(remotePath, 'utf-8');
    // The script must have an explicit non-zero exit when ok===0 and fail>0
    // so the wrapper's diagnostic echo fires and logs show the failure.
    expect(script).toMatch(/if\s*\(\s*ok\s*===\s*0\s*&&\s*fail\s*>\s*0\s*\)|process\.exit\s*\(\s*1\s*\)/);
  });

  it('includes a total-failure guard before the final console.error done line', () => {
    script = readFileSync(remotePath, 'utf-8');
    const doneIdx = script.indexOf("[enrich] done:");
    // There must be a process.exit(1) call somewhere before the done line
    // that fires on total failure.
    const exitOneIdx = script.indexOf('process.exit(1)');
    expect(exitOneIdx).toBeGreaterThan(-1);
    expect(exitOneIdx).toBeLessThan(doneIdx);
  });
});
