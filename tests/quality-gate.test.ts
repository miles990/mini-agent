import { describe, it, expect, beforeEach } from 'vitest';
import { vi } from 'vitest';

vi.mock('../src/utils.js', () => ({
  slog: () => {},
}));

import {
  qualityCheck,
  registerCheck,
  getChecks,
  nonEmptyCheck,
  noErrorLeakCheck,
  noXmlResidueCheck,
  noPlaceholderCheck,
} from '../src/quality-gate.js';
import type { QualityContext } from '../src/quality-gate.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<QualityContext> = {}): QualityContext {
  return {
    source: 'test',
    inputLength: 100,
    isCode: false,
    lane: 'foreground',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// nonEmptyCheck
// ---------------------------------------------------------------------------

describe('nonEmptyCheck', () => {
  it('passes output longer than 10 chars after trim', () => {
    const result = nonEmptyCheck.check('Hello, this is a valid response.', makeCtx());
    expect(result.pass).toBe(true);
  });

  it('fails output that is empty', () => {
    const result = nonEmptyCheck.check('', makeCtx());
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/0 chars/);
  });

  it('fails output of exactly 10 chars after trim', () => {
    const result = nonEmptyCheck.check('1234567890', makeCtx());
    expect(result.pass).toBe(false);
  });

  it('fails whitespace-only output', () => {
    const result = nonEmptyCheck.check('   \n  ', makeCtx());
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/output too short/);
  });

  it('passes output of 11 chars', () => {
    const result = nonEmptyCheck.check('12345678901', makeCtx());
    expect(result.pass).toBe(true);
  });

  it('includes char count in fail reason', () => {
    const result = nonEmptyCheck.check('hi', makeCtx());
    expect(result.reason).toContain('2 chars');
  });
});

// ---------------------------------------------------------------------------
// noErrorLeakCheck
// ---------------------------------------------------------------------------

describe('noErrorLeakCheck', () => {
  it('passes clean output', () => {
    const result = noErrorLeakCheck.check('Here is your answer.', makeCtx());
    expect(result.pass).toBe(true);
  });

  it('fails on raw stack trace (at X (file:line:col) pattern)', () => {
    const output = 'Something went wrong\n    at Object.<anonymous> (/app/src/index.js:10:5)';
    const result = noErrorLeakCheck.check(output, makeCtx());
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/stack trace/);
  });

  it('fails on Error: ... followed by at on next line', () => {
    const output = 'Error: cannot read property\n    at parseResponse (utils.js:42:3)';
    const result = noErrorLeakCheck.check(output, makeCtx());
    expect(result.pass).toBe(false);
  });

  it('fails on rate limit message (rate limit)', () => {
    const result = noErrorLeakCheck.check('Sorry, you have hit a rate limit.', makeCtx());
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/rate limit/);
  });

  it('fails on overloaded message', () => {
    const result = noErrorLeakCheck.check("The API is currently overloaded.", makeCtx());
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/rate limit/);
  });

  it("fails on 'you've hit your limit' variant", () => {
    const result = noErrorLeakCheck.check("you've hit your limit for today", makeCtx());
    expect(result.pass).toBe(false);
  });

  it('fails on credit balance message', () => {
    const result = noErrorLeakCheck.check('Insufficient credit balance to continue.', makeCtx());
    expect(result.pass).toBe(false);
  });

  it('is case-insensitive for rate limit patterns', () => {
    const result = noErrorLeakCheck.check('Rate Limit exceeded.', makeCtx());
    expect(result.pass).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// noXmlResidueCheck
// ---------------------------------------------------------------------------

describe('noXmlResidueCheck', () => {
  it('passes clean prose', () => {
    const result = noXmlResidueCheck.check('Everything looks good here.', makeCtx());
    expect(result.pass).toBe(true);
  });

  it('passes output containing known kuro tags (they are stripped before check)', () => {
    const result = noXmlResidueCheck.check(
      '<kuro:chat>Hello</kuro:chat> This is fine.',
      makeCtx(),
    );
    expect(result.pass).toBe(true);
  });

  it('fails on residual unknown XML-like tag', () => {
    const result = noXmlResidueCheck.check('<tool_use>something</tool_use>', makeCtx());
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/residual XML/);
  });

  it('fails on opening tag with attributes', () => {
    const result = noXmlResidueCheck.check('<function name="foo">', makeCtx());
    expect(result.pass).toBe(false);
  });

  it('strips all known kuro tags before checking', () => {
    const output =
      '<kuro:delegate>some task</kuro:delegate><kuro:remember>note</kuro:remember> done';
    const result = noXmlResidueCheck.check(output, makeCtx());
    expect(result.pass).toBe(true);
  });

  it('fails when residual tag remains after stripping kuro tags', () => {
    const output = '<kuro:chat>ok</kuro:chat> but also <unknown_tag> here';
    const result = noXmlResidueCheck.check(output, makeCtx());
    expect(result.pass).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// noPlaceholderCheck
// ---------------------------------------------------------------------------

describe('noPlaceholderCheck', () => {
  it('passes clean code when isCode is true', () => {
    const result = noPlaceholderCheck.check('function add(a, b) { return a + b; }', makeCtx({ isCode: true }));
    expect(result.pass).toBe(true);
  });

  it('skips check entirely when isCode is false (even with TODO)', () => {
    const result = noPlaceholderCheck.check('TODO: do something later', makeCtx({ isCode: false }));
    expect(result.pass).toBe(true);
  });

  it('fails when code contains TODO', () => {
    const result = noPlaceholderCheck.check('// TODO: implement this', makeCtx({ isCode: true }));
    expect(result.pass).toBe(false);
    expect(result.reason).toMatch(/placeholder/);
  });

  it('fails when code contains FIXME', () => {
    const result = noPlaceholderCheck.check('// FIXME: broken logic', makeCtx({ isCode: true }));
    expect(result.pass).toBe(false);
  });

  it('fails when code contains PLACEHOLDER', () => {
    const result = noPlaceholderCheck.check('const x = PLACEHOLDER;', makeCtx({ isCode: true }));
    expect(result.pass).toBe(false);
  });

  it('fails when code contains XXX', () => {
    const result = noPlaceholderCheck.check('// XXX: remove before ship', makeCtx({ isCode: true }));
    expect(result.pass).toBe(false);
  });

  it('fails when code contains HACK', () => {
    const result = noPlaceholderCheck.check('// HACK: temporary workaround', makeCtx({ isCode: true }));
    expect(result.pass).toBe(false);
  });

  it('is case-sensitive — lowercase "todo" passes', () => {
    // \b(TODO) is uppercase-only
    const result = noPlaceholderCheck.check('// todo: minor note', makeCtx({ isCode: true }));
    expect(result.pass).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// qualityCheck — integration
// ---------------------------------------------------------------------------

describe('qualityCheck', () => {
  it('passes when output is clean', () => {
    const result = qualityCheck('This is a clean and valid response.', makeCtx());
    expect(result.pass).toBe(true);
    expect(result.issues).toHaveLength(0);
    expect(result.checksRun).toBeGreaterThan(0);
  });

  it('fails with all relevant issues collected', () => {
    // Short AND contains rate limit
    const result = qualityCheck('rate limit', makeCtx());
    expect(result.pass).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(2);
  });

  it('reports checksRun equal to number of registered checks', () => {
    const checksCount = getChecks().length;
    const result = qualityCheck('A sufficiently long clean response with no issues.', makeCtx());
    expect(result.checksRun).toBe(checksCount);
  });

  it('collects all failing reasons into issues array', () => {
    const output = 'hi'; // too short
    const result = qualityCheck(output, makeCtx());
    expect(result.pass).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([expect.stringMatching(/output too short/)]));
  });
});

// ---------------------------------------------------------------------------
// registerCheck / getChecks
// ---------------------------------------------------------------------------

describe('registerCheck / getChecks', () => {
  it('getChecks returns at least the 4 default checks', () => {
    const checks = getChecks();
    expect(checks.length).toBeGreaterThanOrEqual(4);
    const names = checks.map(c => c.name);
    expect(names).toContain('non-empty');
    expect(names).toContain('no-error-leak');
    expect(names).toContain('no-xml-residue');
    expect(names).toContain('no-placeholder');
  });

  it('registerCheck adds a check that runs in qualityCheck', () => {
    const sentinel = { called: false };
    registerCheck({
      name: 'test-sentinel',
      check(output) {
        sentinel.called = true;
        return { pass: true, reason: 'ok' };
      },
    });
    qualityCheck('A sufficiently long and clean response.', makeCtx());
    expect(sentinel.called).toBe(true);

    // Clean up: remove by replacing getChecks array is not exposed,
    // but the check ran — that's the contract we care about.
  });
});
