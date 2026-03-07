import { describe, it, expect, afterEach } from 'vitest';
import { withFileLock } from '../src/filelock.js';
import fs from 'node:fs';
import os from 'node:os';
import nodePath from 'node:path';

const tmpDir = nodePath.join(os.tmpdir(), 'mini-agent-filelock-test');

function tmpPath(name: string): string {
  const p = nodePath.join(tmpDir, name);
  fs.mkdirSync(nodePath.dirname(p), { recursive: true });
  return p;
}

afterEach(() => {
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ok */ }
});

describe('withFileLock', () => {
  it('should execute operation and return result', async () => {
    const result = await withFileLock(tmpPath('basic'), async () => {
      return 42;
    });
    expect(result).toBe(42);
  });

  it('should serialize concurrent operations on same path', async () => {
    const order: number[] = [];
    const p = tmpPath('concurrent');

    const op = (id: number, delayMs: number) =>
      withFileLock(p, async () => {
        order.push(id);
        await new Promise((r) => setTimeout(r, delayMs));
        order.push(id * 10);
      });

    await Promise.all([op(1, 20), op(2, 10), op(3, 5)]);

    expect(order[0]).toBe(1);
    expect(order[1]).toBe(10);
    expect(order[2]).toBe(2);
    expect(order[3]).toBe(20);
    expect(order[4]).toBe(3);
    expect(order[5]).toBe(30);
  });

  it('should allow concurrent operations on different paths', async () => {
    const started: string[] = [];

    const op = (name: string) =>
      withFileLock(tmpPath(name), async () => {
        started.push(name);
        await new Promise((r) => setTimeout(r, 10));
      });

    await Promise.all([op('a'), op('b'), op('c')]);

    expect(started).toHaveLength(3);
  });

  it('should release lock even if operation throws', async () => {
    const p = tmpPath('error');

    await expect(
      withFileLock(p, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    const result = await withFileLock(p, async () => 'ok');
    expect(result).toBe('ok');
  });
});
