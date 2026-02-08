import { describe, it, expect } from 'vitest';
import { withFileLock } from '../src/filelock.js';

describe('withFileLock', () => {
  it('should execute operation and return result', async () => {
    const result = await withFileLock('/fake/path', async () => {
      return 42;
    });
    expect(result).toBe(42);
  });

  it('should serialize concurrent operations on same path', async () => {
    const order: number[] = [];
    const path = '/test/concurrent';

    const op = (id: number, delayMs: number) =>
      withFileLock(path, async () => {
        order.push(id);
        await new Promise((r) => setTimeout(r, delayMs));
        order.push(id * 10);
      });

    // Launch 3 concurrent operations on same path
    await Promise.all([op(1, 20), op(2, 10), op(3, 5)]);

    // Should run in sequence: 1 starts, 1 finishes, then 2, then 3
    expect(order[0]).toBe(1);
    expect(order[1]).toBe(10);
    expect(order[2]).toBe(2);
    expect(order[3]).toBe(20);
    expect(order[4]).toBe(3);
    expect(order[5]).toBe(30);
  });

  it('should allow concurrent operations on different paths', async () => {
    const started: string[] = [];

    const op = (p: string) =>
      withFileLock(p, async () => {
        started.push(p);
        await new Promise((r) => setTimeout(r, 10));
      });

    await Promise.all([op('/path/a'), op('/path/b'), op('/path/c')]);

    // All 3 should have started (different paths = no waiting)
    expect(started).toHaveLength(3);
  });

  it('should release lock even if operation throws', async () => {
    const path = '/test/error';

    // First operation throws
    await expect(
      withFileLock(path, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');

    // Second operation should still work (lock was released)
    const result = await withFileLock(path, async () => 'ok');
    expect(result).toBe('ok');
  });
});
