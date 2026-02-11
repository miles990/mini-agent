import { describe, test, expect } from 'vitest';
import { parseVerifyLine, runVerify, registerPrimitive } from '../src/verify.js';

describe('parseVerifyLine', () => {
  test('shell command (backtick)', () => {
    const specs = parseVerifyLine('`echo hello`');
    expect(specs).toEqual([{ type: 'shell', name: 'echo hello', args: [] }]);
  });

  test('primitive with args', () => {
    const specs = parseVerifyLine('file-contains foo.md "bar" --min-lines 3');
    expect(specs[0]).toEqual({
      type: 'primitive',
      name: 'file-contains',
      args: ['foo.md', 'bar', '--min-lines', '3'],
    });
  });

  test('AND composition', () => {
    const specs = parseVerifyLine('git-pushed AND service-healthy localhost:3001');
    expect(specs).toHaveLength(2);
    expect(specs[0].name).toBe('git-pushed');
    expect(specs[1].name).toBe('service-healthy');
  });

  test('unknown name falls back to shell', () => {
    const specs = parseVerifyLine('some-unknown-thing arg1');
    expect(specs[0].type).toBe('shell');
  });

  test('single primitive without args', () => {
    const specs = parseVerifyLine('git-pushed');
    expect(specs).toEqual([{ type: 'primitive', name: 'git-pushed', args: [] }]);
  });
});

describe('runVerify', () => {
  test('shell command passes', async () => {
    const result = await runVerify('`echo ok`', process.cwd());
    expect(result.passed).toBe(true);
  });

  test('shell command fails', async () => {
    const result = await runVerify('`exit 1`', process.cwd());
    expect(result.passed).toBe(false);
  });

  test('file-exists passes for package.json', async () => {
    const result = await runVerify('file-exists package.json', process.cwd());
    expect(result.passed).toBe(true);
    expect(result.details[0].message).toBe('exists');
  });

  test('file-exists fails for nonexistent', async () => {
    const result = await runVerify('file-exists nonexistent.xyz', process.cwd());
    expect(result.passed).toBe(false);
    expect(result.details[0].message).toBe('not found');
  });

  test('file-contains finds pattern', async () => {
    const result = await runVerify('file-contains package.json "name"', process.cwd());
    expect(result.passed).toBe(true);
  });

  test('file-contains with --min-lines', async () => {
    const result = await runVerify('file-contains package.json ":" --min-lines 3', process.cwd());
    expect(result.passed).toBe(true);
  });

  test('file-contains fails for missing file', async () => {
    const result = await runVerify('file-contains nonexistent.xyz "foo"', process.cwd());
    expect(result.passed).toBe(false);
    expect(result.details[0].message).toBe('file not found');
  });

  test('AND requires all pass', async () => {
    const result = await runVerify(
      'file-exists package.json AND file-exists nonexistent.xyz',
      process.cwd(),
    );
    expect(result.passed).toBe(false);
    expect(result.details[0].passed).toBe(true);
    expect(result.details[1].passed).toBe(false);
  });

  test('AND passes when all pass', async () => {
    const result = await runVerify(
      'file-exists package.json AND file-exists tsconfig.json',
      process.cwd(),
    );
    expect(result.passed).toBe(true);
    expect(result.details).toHaveLength(2);
  });
});

describe('port-open', () => {
  test('fails for unused port', async () => {
    const result = await runVerify('port-open 59999', process.cwd());
    expect(result.passed).toBe(false);
  });
});

describe('registerPrimitive', () => {
  test('custom primitive works', async () => {
    registerPrimitive('always-pass', async () => ({
      spec: 'always-pass',
      passed: true,
      message: 'ok',
    }));
    const result = await runVerify('always-pass', process.cwd());
    expect(result.passed).toBe(true);
    expect(result.details[0].message).toBe('ok');
  });

  test('custom primitive with args', async () => {
    registerPrimitive('echo-check', async (args) => ({
      spec: `echo-check ${args.join(' ')}`,
      passed: args.length > 0,
      message: args.join(','),
    }));
    const result = await runVerify('echo-check hello world', process.cwd());
    expect(result.passed).toBe(true);
    expect(result.details[0].message).toBe('hello,world');
  });
});
